import either, { type Either } from '@matt.kantor/either'
import option from '@matt.kantor/option'
import {
  analyze,
  defaultConfiguration,
  hoverAt,
  lineAndColumnAtOffset,
  offsetAtLineAndColumn,
  type Analysis,
  type Diagnostic,
  type DiagnosticSeverity,
  type Span,
} from '@matt.kantor/please'
import { TextDocument } from 'vscode-languageserver-textdocument'
import {
  createConnection,
  DiagnosticSeverity as LspDiagnosticSeverity,
  MarkupKind,
  TextDocuments,
  TextDocumentSyncKind,
  type DiagnosticRelatedInformation,
  type InitializeResult,
  type Diagnostic as LspDiagnostic,
  type Hover as LspHover,
  type Position,
  type Range,
} from 'vscode-languageserver/node'

/**
 * How long to wait for typing to settle before re-analyzing a document.
 */
const analysisDebounceMilliseconds = 300

const connection = createConnection()
const documents = new TextDocuments(TextDocument)
const analyzeSource = analyze(defaultConfiguration)

type DocumentURI = string

/**
 * Pending re-analysis timers. Mutable so it can track work in flight.
 */
const scheduledAnalyses = new Map<DocumentURI, NodeJS.Timeout>()

/**
 * The most recent analysis of each open document. Mutable because entries are
 * replaced as documents change. This is an optimization: re-analyzing on every
 * request would work, but be slow.
 */
const analyses = new Map<
  DocumentURI,
  {
    readonly version: number
    readonly analysis: Either<Error, Analysis>
  }
>()

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
  (uri: DocumentURI, source: string) =>
  (diagnostic: Diagnostic): LspDiagnostic => ({
    severity: lspSeverities[diagnostic.severity],
    range: rangeOfSpan(source, diagnostic.span),
    message: diagnostic.message,
    code: diagnostic.code,
    source: 'please',
    relatedInformation: diagnostic.relatedSpans.map(
      (related): DiagnosticRelatedInformation => ({
        location: { uri, range: rangeOfSpan(source, related.span) },
        message: related.message,
      }),
    ),
  })

const analyzeDocument = (document: TextDocument): Either<Error, Analysis> => {
  const cached = analyses.get(document.uri)
  if (cached?.version === document.version) {
    return cached.analysis
  } else {
    const analysis = ((): Either<Error, Analysis> => {
      // A program which crashes the compiler degrades to no diagnostics/hovers
      // rather than taking down the language server.
      try {
        return either.makeRight(analyzeSource(document.getText()))
      } catch (cause) {
        const message = `Analysis of ${document.uri} failed. This is a bug!`
        connection.console.error(`${message}\nCaused by: ${String(cause)}`)
        return either.makeLeft(new Error(message, { cause }))
      }
    })()
    // Failures are cached so a document which crashes the compiler does so once
    // per edit rather than once per request.
    analyses.set(document.uri, { version: document.version, analysis })
    return analysis
  }
}

const publishDiagnostics = (document: TextDocument): undefined => {
  const source = document.getText()
  void connection.sendDiagnostics({
    uri: document.uri,
    version: document.version,
    diagnostics: either.match(analyzeDocument(document), {
      left: _ => [],
      right: analysis =>
        analysis.diagnostics.map(toLspDiagnostic(document.uri, source)),
    }),
  })
}

const cancelScheduledAnalysis = (uri: DocumentURI): undefined => {
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

const hoverForPosition = (
  document: TextDocument,
  position: Position,
): LspHover | undefined => {
  const source = document.getText()
  const offset = offsetAtLineAndColumn(source, {
    line: position.line + 1,
    column: position.character + 1,
  })
  return either.match(analyzeDocument(document), {
    left: _ => undefined,
    right: ({ parsed }) =>
      option.match(
        option.flatMap(parsed, program => hoverAt(program, offset)),
        {
          none: _ => undefined,
          some: ({ span, type }) => ({
            contents: {
              kind: MarkupKind.Markdown,
              // The code block gets syntax highlighting.
              value: ['```plz', type, '```'].join('\n'),
            },
            range: rangeOfSpan(source, span),
          }),
        },
      ),
  })
}

connection.onInitialize((): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Full,
    hoverProvider: true,
  },
}))

connection.onHover(({ textDocument, position }) => {
  const document = documents.get(textDocument.uri)
  return document === undefined ? undefined : (
      hoverForPosition(document, position)
    )
})

// This also fires when a document is first opened.
documents.onDidChangeContent(({ document }) => {
  scheduleAnalysis(document)
})

documents.onDidClose(({ document }) => {
  cancelScheduledAnalysis(document.uri)
  analyses.delete(document.uri)
  void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] })
})

documents.listen(connection)
connection.listen()
