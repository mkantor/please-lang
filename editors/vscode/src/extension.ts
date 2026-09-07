import { commands, type ExtensionContext } from 'vscode'
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node'

const languageId = 'plz'

let client: LanguageClient | undefined

export const activate = (context: ExtensionContext): void => {
  const languageClient = makeClient(context)
  client = languageClient
  context.subscriptions.push(
    commands.registerCommand('please.restartServer', async () => {
      await languageClient.restart()
    }),
  )
  void languageClient.start()
}

export const deactivate = async (): Promise<void> => {
  const clientToStop = client
  client = undefined
  await clientToStop?.stop()
}

const makeClient = (context: ExtensionContext): LanguageClient => {
  const module = context.asAbsolutePath('dist/server.js')
  const serverOptions: ServerOptions = {
    // IPC keeps the protocol off stdio, so compiler writes to stdout/stderr
    // won't corrupt the message stream.
    run: { module, transport: TransportKind.ipc },
    debug: {
      module,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  }
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: languageId }],
  }
  return new LanguageClient(
    'please',
    'Please Language Server',
    serverOptions,
    clientOptions,
  )
}
