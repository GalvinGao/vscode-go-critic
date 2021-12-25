// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode'
import * as cp from 'child_process'

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "go-critic" is now active!')

  // // The command has been defined in the package.json file
  // // Now provide the implementation of the command with registerCommand
  // // The commandId parameter must match the command field in package.json
  // let disposable = vscode.commands.registerCommand(
  //   'go-critic.helloWorld',
  //   () => {
  //     // The code you place here will be executed every time your command is executed
  //     // Display a message box to the user
  //     vscode.window.showInformationMessage('Hello World from Go Report!')
  //   },
  // )

  // context.subscriptions.push(disposable)

  let critic = new GoCritic()
  critic.activate(context.subscriptions)
}

// this method is called when your extension is deactivated
export function deactivate() {}

class GoCritic {
  diagnosticCollection: vscode.DiagnosticCollection = vscode.languages.createDiagnosticCollection()
  logger: vscode.OutputChannel = vscode.window.createOutputChannel('Go Critic (customizable)')

  activate(subscriptions: vscode.Disposable[]) {
    vscode.workspace.onDidOpenTextDocument(this.doLint, this, subscriptions)
    vscode.workspace.onDidCloseTextDocument(
      (textDocument) => {
        this.diagnosticCollection.delete(textDocument.uri)
      },
      null,
      subscriptions,
    )

    vscode.workspace.onDidSaveTextDocument(this.doLint, this)
    vscode.workspace.textDocuments.forEach(this.doLint, this)
  }

  dispose(): void {
    this.diagnosticCollection.clear()
    this.diagnosticCollection.dispose()
  }

  doLint(textDocument: vscode.TextDocument) {
    if (textDocument.languageId !== 'go') {
      return
    }

    this.getGoCriticOutput(textDocument.fileName)
      .then((warnings) => {
        let diagnostics: vscode.Diagnostic[] = []
        warnings.forEach((item) => {
          let lineSnippet = textDocument.lineAt(item.line).text
          let startCol = lineSnippet.length - lineSnippet.trimLeft().length
          let endCol = lineSnippet.length
          let [startPosition, endPosition] = [
            new vscode.Position(item.line, startCol),
            new vscode.Position(item.line, endCol),
          ]
          let range = new vscode.Range(startPosition, endPosition)
          let message = `${item.rule}: ${item.warning}`
          let diagnostic = new vscode.Diagnostic(
            range,
            message,
            vscode.DiagnosticSeverity.Warning,
          )
          diagnostics.push(diagnostic)
        })
        this.diagnosticCollection.set(textDocument.uri, diagnostics)
      })
      .catch((err) => {
        console.error(err)
      })
  }

  private getGoCriticOutput(
    filename: string,
  ): Promise<{ line: number; col: number; rule: string; warning: string }[]> {
    let args = ['check']
    const ignored = vscode.workspace.getConfiguration('go-critic').get('ignoredCheckers') as string[] | undefined
    if (ignored?.length) {
      args.push(`-disable=${ignored.join(',')}`)
    }

    const verbose = vscode.workspace.getConfiguration('go-critic').get('verbose') as boolean
    if (verbose) {
      args.push('-v')
    }

    args.push(filename)
    return new Promise((resolve, reject) => {
      cp.exec('gocritic ' + args.join(' '), (err, _, stdErr) => {
        let decoded = stdErr
        if (err !== null) {
          if (err.message.startsWith('Command failed')) {
            decoded = err.message.split('\n').slice(1).join('\n')
          } else {
            reject(err)
          }
        }
        const warnings = decoded
          .split('\n')
          .filter((x) => x !== '')
          .map((x) => {
            let colonSections = x.split(':')
            let [line, col] = colonSections
              .slice(1, 3)
              .map((i) => Number.parseInt(i) - 1)
            let rule = colonSections[3]
            let warning = colonSections.slice(4).join(':')
            return {
              line,
              col,
              rule,
              warning,
            }
          })

        if (verbose && warnings.length !== 0) {
          this.logger.appendLine(
            `Go Critic found ${warnings.length} warnings in ${filename}`,
          )
          warnings.forEach((warning) => {
            this.logger.appendLine(
              `${warning.line}:${warning.col} [${warning.rule}]: ${warning.warning}`,
            )
          })
        }
        resolve(warnings)
      })
    })
  }
}
