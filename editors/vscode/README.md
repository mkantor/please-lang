# Please for VS Code

Editor support for `.plz` files.

## What it does

- **Syntax highlighting** via a TextMate grammar.
- **Diagnostics** from a language server running the compiler.

## Development

From the repository root:

```sh
npm install # installs both packages and links this one to the compiler
npm run build:all
```

Then open the repository in VS Code and press <kbd>F5</kbd> to launch an
Extension Development Host with this extension loaded in watch mode.

The server loads the compiler when it starts, so after changing anything in it
you'll need to run **Please: Restart Language Server** or reload the window.

To debug the server, use the **Extension + Language Server** launch
configuration which attaches a debugger to the server child process.

### The grammar is generated

`syntaxes/please.tmLanguage.json` is written by
`src/language/highlighting/tmlanguage.ts` at the repository root. Run
`npm run build:grammar` after editing it.
