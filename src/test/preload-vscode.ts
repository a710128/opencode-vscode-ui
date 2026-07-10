import { mock } from "bun:test"

class Disposable {
  dispose() {}

  static from(...items: Array<{ dispose?: () => void }>) {
    return {
      dispose() {
        for (const item of items) {
          item.dispose?.()
        }
      },
    }
  }
}

class EventEmitter<T> {
  private listeners: Array<(event: T) => void> = []

  event = (listener: (event: T) => void) => {
    this.listeners.push(listener)
    return new Disposable()
  }

  fire(event: T) {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  dispose() {}
}

mock.module("vscode", () => ({
  Disposable,
  EventEmitter,
  ViewColumn: {
    Active: 1,
  },
  window: {
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
    registerTreeDataProvider: () => new Disposable(),
    createTreeView: () => ({
      onDidExpandElement: () => new Disposable(),
      dispose() {},
    }),
    registerWebviewViewProvider: () => new Disposable(),
    registerWebviewPanelSerializer: () => new Disposable(),
    createWebviewPanel: () => ({
      webview: {
        postMessage: async () => true,
        onDidReceiveMessage: () => new Disposable(),
        asWebviewUri: (value: unknown) => value,
      },
      onDidDispose: () => new Disposable(),
      onDidChangeViewState: () => new Disposable(),
      reveal() {},
    }),
  },
  workspace: {
    workspaceFolders: [],
    createFileSystemWatcher: () => ({
      onDidCreate: () => new Disposable(),
      onDidChange: () => new Disposable(),
      onDidDelete: () => new Disposable(),
      dispose() {},
    }),
    onDidChangeWorkspaceFolders: () => new Disposable(),
    onDidChangeConfiguration: () => new Disposable(),
    getConfiguration: () => ({
      get: <T>(_key: string, fallback: T) => fallback,
    }),
    fs: {
      readFile: async () => new Uint8Array(),
      stat: async () => ({ type: 0 }),
    },
    openTextDocument: async () => ({}),
  },
  commands: {
    executeCommand: async () => undefined,
    registerCommand: () => new Disposable(),
  },
  env: {
    remoteName: undefined,
    uiKind: 1,
    openExternal: async () => true,
  },
  UIKind: {
    1: "Desktop",
    Desktop: 1,
  },
  Uri: {
    file: (path: string) => ({ fsPath: path, path, toString: () => path }),
    parse: (value: string) => ({ fsPath: value, path: value, toString: () => value }),
    joinPath: (...parts: Array<{ path?: string; fsPath?: string } | string>) => {
      const path = parts.map((part) => typeof part === "string" ? part : (part.path ?? part.fsPath ?? "")).join("/")
      return { fsPath: path, path, toString: () => path }
    },
  },
  Position: class {},
  Selection: class {},
  Range: class {},
  TextEditorRevealType: {
    InCenterIfOutsideViewport: 0,
  },
  FileType: {
    Directory: 2,
  },
  ThemeIcon: class {},
  TreeItem: class {},
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
}))
