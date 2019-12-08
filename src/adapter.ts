import * as vscode from 'vscode';
import {
  TestAdapter,
  TestLoadStartedEvent,
  TestLoadFinishedEvent,
  TestRunStartedEvent,
  TestRunFinishedEvent,
  TestSuiteEvent,
  TestEvent } from 'vscode-test-adapter-api';
import * as cppunit from './cppunit';

export class CppUnitTestAdapter implements TestAdapter {

  private disposables: { dispose(): void }[] = [];

  private readonly testsEmitter = new vscode.EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();
  private readonly testStatesEmitter = new vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>();
  private readonly autorunEmitter = new vscode.EventEmitter<void>();

  testSuiteManager: cppunit.TestSuiteManager;

  get tests(): vscode.Event<TestLoadStartedEvent | TestLoadFinishedEvent> { return this.testsEmitter.event; }
  get testStates(): vscode.Event<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent> { return this.testStatesEmitter.event; }
  get autorun(): vscode.Event<void> | undefined { return this.autorunEmitter.event; }

  constructor(public readonly workspace: vscode.WorkspaceFolder) {
    this.disposables.push(this.testsEmitter);
    this.disposables.push(this.testStatesEmitter);
    this.disposables.push(this.autorunEmitter);

    let paths = vscode.workspace.getConfiguration('cppUnitExplorer').get<Array<cppunit.TestExecutableSpecification>>('executables');
    if(paths === undefined) {
      paths = []
    }
    let config: cppunit.Config = {
      cppUnitExecutables: paths
    }
    this.testSuiteManager = new cppunit.TestSuiteManager(config);
  }

  async load(): Promise<void> {
    this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });
    const cppUnitTests = await this.testSuiteManager.loadTests();
    this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', suite: cppUnitTests });
  }

  async run(tests: string[]): Promise<void> {
    this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests });
    await this.testSuiteManager.runTests(tests, this.testStatesEmitter);
    this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });
  }

  cancel(): void {
    throw new Error("Method not implemented.");
  }

  dispose(): void {
    this.cancel();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
