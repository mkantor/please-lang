import {
  defaultConfiguration,
  diagnose,
  lineAndColumnAtOffset,
  type Diagnostic,
  type DiagnosticSeverity,
  type Span,
} from 'please-prototype'
import { TextDocument } from 'vscode-languageserver-textdocument'
import {
  createConnection,
  DiagnosticSeverity as LspDiagnosticSeverity,
  TextDocuments,
  TextDocumentSyncKind,
  type InitializeResult,
  type Diagnostic as LspDiagnostic,
  type Position,
  type Range,
} from 'vscode-languageserver/node'

/**
 * How long to wait for typing to settle before re-analyzing a document.
 */
const analysisDebounceMilliseconds = 300

const connection = createConnection()
const documents = new TextDocuments(TextDocument)
const diagnoseSource = diagnose(defaultConfiguration)

/**
 * Pending re-analysis timers, keyed by document URI. Mutable because it tracks
 * work in flight.
 */
const scheduledAnalyses = new Map<string, NodeJS.Timeout>()

const positionAtOffset = (source: string, offset: number): Position => {
  const { line, column } = lineAndColumnAtOffset(source, offset)
  return { line: line - 1, character: column - 1 }
}

/**
 * Parse errors are reported at a single point, and a zero-width range is nearly
 * invisible. Widen those by one character (without crossing a line break).
 */
const rangeOfSpan = (source: string, [start, end]: Span): Range => {
  const widenedEnd =
    end > start ? end
    : source[start] === undefined || source[start] === '\n' ? start
    : start + 1
  return {
    start: positionAtOffset(source, start),
    end: positionAtOffset(source, widenedEnd),
  }
}

const lspSeverities: Readonly<
  Record<DiagnosticSeverity, LspDiagnosticSeverity>
> = {
  error: LspDiagnosticSeverity.Error,
  warning: LspDiagnosticSeverity.Warning,
  information: LspDiagnosticSeverity.Information,
  hint: LspDiagnosticSeverity.Hint,
}

const toLspDiagnostic =
  (source: string) =>
  (diagnostic: Diagnostic): LspDiagnostic => ({
    severity: lspSeverities[diagnostic.severity],
    range: rangeOfSpan(source, diagnostic.span),
    message: diagnostic.message,
    code: diagnostic.code,
    source: 'please',
  })

const diagnosticsForDocument = (
  document: TextDocument,
): readonly LspDiagnostic[] => {
  const source = document.getText()
  // A program which crashes the compiler degrades to "no diagnostics" rather
  // than taking down the process.
  try {
    return diagnoseSource(source).map(toLspDiagnostic(source))
  } catch (error) {
    connection.console.error(
      `analysis of ${document.uri} failed: ${String(error)}`,
    )
    return []
  }
}

const publishDiagnostics = (document: TextDocument): undefined => {
  void connection.sendDiagnostics({
    uri: document.uri,
    version: document.version,
    diagnostics: [...diagnosticsForDocument(document)],
  })
}

const cancelScheduledAnalysis = (uri: string): undefined => {
  const scheduled = scheduledAnalyses.get(uri)
  if (scheduled !== undefined) {
    clearTimeout(scheduled)
    scheduledAnalyses.delete(uri)
  }
}

const scheduleAnalysis = (document: TextDocument): undefined => {
  cancelScheduledAnalysis(document.uri)
  scheduledAnalyses.set(
    document.uri,
    setTimeout(() => {
      scheduledAnalyses.delete(document.uri)
      // Re-read the document to ensure analysis describes the newest content.
      const current = documents.get(document.uri)
      if (current !== undefined) {
        publishDiagnostics(current)
      }
    }, analysisDebounceMilliseconds),
  )
}

connection.onInitialize((): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Full,
  },
}))

// This also fires when a document is first opened.
documents.onDidChangeContent(({ document }) => {
  scheduleAnalysis(document)
})

documents.onDidClose(({ document }) => {
  cancelScheduledAnalysis(document.uri)
  void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] })
})

documents.listen(connection)
connection.listen()
