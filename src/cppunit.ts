import * as vscode from 'vscode';
import * as util from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { parse } from 'fast-xml-parser';
import {
  TestSuiteInfo,
  TestInfo,
  TestRunStartedEvent,
  TestRunFinishedEvent,
  TestSuiteEvent,
  TestEvent } from 'vscode-test-adapter-api';

export interface TestExecutableSpecification {
  // Path to the test executable.
  exePath: string;
  // Path to the associated XML report
  xmlPath: string;
};

export interface Config {
  // All considered test executables
  cppUnitExecutables: Array<TestExecutableSpecification>;
};

interface TestCaseResult {
  // Success or failure
  result: boolean;
  // Information about a failure
  message?: string;
  // The source file path
  filePath?: string;
  // The line number
  line?: number;
};

interface TestCase {
  kind: 'TestCase'
  // The name of a single test case
  name: string;
  // The result of this test case
  result?: TestCaseResult;
};

interface TestSuite {
  kind: 'TestSuite'
  // The name of the CppUnit test fixture
  name: string;
  // Test fixture test cases
  testCases: Array<TestCase>;
};

enum UpdateKind {
  // A new test case has been added
  NewTestCase = 0,
  // A new test suite has been added
  NewTestSuite = 1,
  // The result of test case has changed
  ChangedResult = 2,
  // Nothing changed
  Unchanged = 3
}

interface Index {
  // Index of the test suite
  suiteIndex: number;
  // Index of the test case
  caseIndex: number;
}

interface UpdateState {
  // What kind of information has changed
  kind: UpdateKind;
  // The current result
  result: TestCaseResult;
  // Index of the suite and the test case
  index: Index;
};

export class TestSuiteManager {

  testSuits: Array<TestSuite> = [];

  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  addOrUpdateTestSuites(testSuiteName: string, testCaseName: string, testCaseResult: TestCaseResult): [UpdateKind, Index] {
    if(this.testSuits.length > 0) {
      for(let suiteIdx = 0; suiteIdx < this.testSuits.length; suiteIdx++) {
        let suite = this.testSuits[suiteIdx];
        if(suite.name === testSuiteName) {
          for(let testCaseIdx = 0; testCaseIdx < suite.testCases.length; testCaseIdx++) {
            let testCase = suite.testCases[testCaseIdx];
            if(testCase.name === testCaseName) {
              let curResult = testCase.result;
              let comIdx: Index = {
                suiteIndex: suiteIdx,
                caseIndex: testCaseIdx
              };

              if(curResult !== undefined) {
                if((curResult.result != testCaseResult.result)
                || (curResult.line != testCaseResult.line)
                || (curResult.filePath != testCaseResult.filePath)) {
                  curResult = testCaseResult;
                  return [UpdateKind.ChangedResult, comIdx];
                }
              }
              return [UpdateKind.Unchanged, comIdx];
            }
          }
          suite.testCases.push({
            kind: "TestCase",
            name: testCaseName,
            result: testCaseResult
          });
          return [UpdateKind.NewTestCase, {
            suiteIndex: suiteIdx,
            caseIndex: suite.testCases.length-1}];
        }
      }
    }
    this.testSuits.push({
      kind: "TestSuite",
      name: testSuiteName,
      testCases: [{
        kind: "TestCase",
        name: testCaseName,
        result: testCaseResult
      }]
    });
    return [UpdateKind.NewTestSuite, {
      suiteIndex: this.testSuits.length-1,
      caseIndex: 0}];
  }

  makeUniqueIndex(suiteId: number, caseId: number): string {
    // Concatenate the indexes and build the cartesian product
    // in order to make the index unique across the whole tree.
    return `${suiteId}.${caseId}`;
  }

  buildTestSuiteInfo(): TestSuiteInfo {
    let testSuiteInfo: Array<TestSuiteInfo> = [];
    for(let testSuiteIdx = 0; testSuiteIdx < this.testSuits.length; testSuiteIdx++) {
      let testSuite = this.testSuits[testSuiteIdx];
      let testInfo: Array<TestInfo> = [];
      for(let testCaseIdx = 0; testCaseIdx < testSuite.testCases.length; testCaseIdx++) {
        let testCase = testSuite.testCases[testCaseIdx];
        let testCaseInfo: TestInfo = {
          type: 'test',
          id: this.makeUniqueIndex(testSuiteIdx, testCaseIdx),
          label: testCase.name
        };
        // File and line are only propagated in case of
        // a test failure. Currently requires to reload
        // all tests.
        if((testCase.result !== undefined) && !testCase.result.result) {
          testCaseInfo.file = testCase.result.filePath;
          testCaseInfo.line = testCase.result.line;
        }
        testInfo.push(testCaseInfo);
      }
      testSuiteInfo.push({
        type: 'suite',
        id: testSuiteIdx.toString(),
        label: testSuite.name,
        children: testInfo
      });
    }
    return {
      'type': 'suite',
      'id': 'root',
      'label': 'root',
      'children': testSuiteInfo
    }
  }

  parseTestCaseName(testCaseName: string): Array<string> {
    return testCaseName.split("::");
  }

  readFailedTest(failedTest: any): UpdateState {
    const names = this.parseTestCaseName(failedTest.Name);
    const lastIdx = names.length-1;
    const res: TestCaseResult = {
      result: false,
      message: failedTest.Message,
      filePath: failedTest.Location.File,
      line: failedTest.Location.Line
    };
    const uptState = this.addOrUpdateTestSuites(names[lastIdx-1], names[lastIdx], res);
    return {
      kind: uptState[0],
      index: uptState[1],
      result: res
    };
  }

  readSuccessfulTest(successfulTest: any): UpdateState {
    const names = this.parseTestCaseName(successfulTest.Name);
    const lastIdx = names.length-1;
    const res = {
      result: true
    };
    const uptState = this.addOrUpdateTestSuites(names[lastIdx-1], names[lastIdx], res);
    return {
      kind: uptState[0],
      index: uptState[1],
      result: res
    };
  }

  readTest(test: any, isFailed: boolean, changeCb?: (state: UpdateState) => void) {
    let res: UpdateState;
    if(isFailed) {
      res = this.readFailedTest(test);
    } else {
      res = this.readSuccessfulTest(test);
    }
    if(changeCb != undefined) {
      changeCb(res);
    }
  }

  readTests(testSet: any, changeCb?: (state: UpdateState) => void) {
    if(util.isObject(testSet)) {
      let tests = undefined;
      let isFailedTest = 'FailedTest' in testSet;
      if(isFailedTest) {
        tests = testSet.FailedTest;
      } else if ('Test' in testSet) {
        tests = testSet.Test;
      }
      if(util.isArray(tests)) {
        for(let test of tests) {
          this.readTest(test, isFailedTest, changeCb);
        }
      } else if(util.isObject(tests)) {
        this.readTest(tests, isFailedTest, changeCb);
      }
    }
  }

  async loadTest(xmlPath: string, changeCb?: (state: UpdateState) => void) {
    try {
      let xmlData = await util.promisify(fs.readFile)(xmlPath, {encoding: 'latin1'});
      let cppUnitTestSuites = parse(xmlData);
      this.readTests(cppUnitTestSuites.TestRun.FailedTests, changeCb);
      this.readTests(cppUnitTestSuites.TestRun.SuccessfulTests, changeCb);
    } catch(error) {
      console.log(error);
    }
  }

  async loadTests() : Promise<TestSuiteInfo> {
    for(let test of this.config.cppUnitExecutables) {
      await this.loadTest(test.xmlPath);
    }
    return Promise.resolve<TestSuiteInfo>(this.buildTestSuiteInfo());
  }

  findTestCase(id: string): TestSuite | TestCase {
    let ids = id.split('.');
    let suite = this.testSuits[parseInt(ids[0])];
    if(ids.length > 1) {
      return suite.testCases[parseInt(ids[1])];
    }
    return suite;
  }

  async evaluateTestResults(xmlPath: string, reqIds: Array<Index>, testEventEmitter: vscode.EventEmitter<
    TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>) {
    await this.loadTest(xmlPath, (state: UpdateState) => {
      switch(state.kind) {
        case UpdateKind.NewTestCase: break;
        case UpdateKind.NewTestSuite: break;
        default: {
          let idx = state.index;
          let arIdx = reqIds.findIndex((searchIdx) => {
            return (searchIdx.suiteIndex === idx.suiteIndex)
              && (searchIdx.caseIndex === idx.caseIndex);
            });
          if(arIdx != -1) {
            const isSuccess = state.result.result;
            testEventEmitter.fire(<TestEvent>{ type: 'test', test: this.makeUniqueIndex(idx.suiteIndex, idx.caseIndex),
              state: isSuccess ? 'passed' : 'failed',
              message: !isSuccess ? state.result.message : undefined});
            reqIds.splice(arIdx, 1);
          } else {
            // New test case or test suite.
          }
        }
      }
    });
    // If test cases have been removed mark them
    // as 'skipped' in the test explorer.
    for(let remId of reqIds) {
      testEventEmitter.fire(<TestEvent>{ type: 'test', test: this.makeUniqueIndex(remId.suiteIndex, remId.caseIndex),
        state: 'skipped'});
    }
  }

  async runTests(tests: string[], testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>) : Promise<void> {
    for (const suiteOrTestId of tests) {
      if(suiteOrTestId === 'root') {
        return;
      }
      const suiteOrTestCase = this.findTestCase(suiteOrTestId);
      switch(suiteOrTestCase.kind) {
        case "TestSuite": {
          testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: suiteOrTestId, state: 'running' });
          let reqTestCases: Array<Index> = [];
          for(let testCaseIdx = 0; testCaseIdx < suiteOrTestCase.testCases.length; testCaseIdx++) {
            let comIdx: Index = {
              suiteIndex: parseInt(suiteOrTestId),
              caseIndex: testCaseIdx
            };
            reqTestCases.push(comIdx);
            testStatesEmitter.fire(<TestEvent>{ type: 'test', test: this.makeUniqueIndex(comIdx.suiteIndex, comIdx.caseIndex), state: 'running' });
          }
          const config = this.config.cppUnitExecutables[0];
          try {
            await util.promisify(exec)('./'+path.basename(config.exePath),
              {cwd: path.dirname(config.exePath)});
          } catch(error) {
            console.log(error);
          }
          await this.evaluateTestResults(config.xmlPath, reqTestCases, testStatesEmitter);
          testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: suiteOrTestId, state: 'completed' });
          break;
        }
        case "TestCase": {
          // It is not possible to run a single test case.
          break;
        }
      }
    }
  }
};

