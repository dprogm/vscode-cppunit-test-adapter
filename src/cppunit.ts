import * as vscode from 'vscode';
import { parse } from 'fast-xml-parser'
import {
  TestSuiteInfo,
  TestInfo,
  TestRunStartedEvent,
  TestRunFinishedEvent,
  TestSuiteEvent,
  TestEvent } from 'vscode-test-adapter-api';

let XML_DATA = `
<?xml version="1.0" encoding='ISO-8859-1' standalone='yes' ?>
<TestRun>
  <FailedTests></FailedTests>
  <SuccessfulTests>
    <Test id="1">
      <Name>TestBasicMath::testAddition</Name>
    </Test>
    <Test id="2">
      <Name>TestBasicMath::testMultiply</Name>
    </Test>
  </SuccessfulTests>
  <Statistics>
    <Tests>2</Tests>
    <FailuresTotal>0</FailuresTotal>
    <Errors>0</Errors>
    <Failures>0</Failures>
  </Statistics>
</TestRun>`;

interface TestCase {
  kind: 'TestCase'
  // The name of a single test case
  name: string;
  // Current state, either 'successful' or 'failed'
  state?: boolean ;
};

interface TestSuite {
  kind: 'TestSuite'
  // The name of the CppUnit test fixture
  name: string;
  // Test fixture test cases
  testCases: Array<TestCase>;
};

export class TestSuiteManager {

  testSuits: Array<TestSuite> = [];

  addOrUpdateTestSuites(testSuiteName: string, testCaseName: string) {
    if(this.testSuits.length > 0) {
      for(let suite of this.testSuits) {
        if(suite.name === testSuiteName) {
          for(let testCase of suite.testCases) {
            if(testCase.name !== testCaseName) {
              suite.testCases.push({
                kind: "TestCase",
                name: testCaseName
              });
            }
          }
          return;
        }
      }
    }
    this.testSuits.push({
      kind: "TestSuite",
      name: testSuiteName,
      testCases: [{
        kind: "TestCase",
        name: testCaseName
      }]
    });
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
        testInfo.push({
          type: 'test',
          id: this.makeUniqueIndex(testSuiteIdx, testCaseIdx),
          label: testCase.name
        });
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

  loadTests() : Promise<TestSuiteInfo> {
    let cppUnitTestSuites = parse(XML_DATA);
    console.log(cppUnitTestSuites);
    console.log(cppUnitTestSuites.TestRun.FailedTests)

    for (const testCase of cppUnitTestSuites.TestRun.SuccessfulTests.Test) {
      let names = this.parseTestCaseName(testCase.Name);
      let lastIdx = names.length-1;
      this.addOrUpdateTestSuites(names[lastIdx-1], names[lastIdx]);
    }

    console.log(this.testSuits);
    let suiteInfo = this.buildTestSuiteInfo();
    console.log(suiteInfo);
    return Promise.resolve<TestSuiteInfo>(suiteInfo);
  }

  findTestCase(id: string): TestSuite | TestCase {
    let ids = id.split('.');
    let suite = this.testSuits[parseInt(ids[0])];
    if(ids.length > 1) {
      return suite.testCases[parseInt(ids[1])];
    }
    return suite;
  }

  async runTests(tests: string[], testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>) : Promise<void> {
    for (const suiteOrTestId of tests) {
      const suiteOrTestCase = this.findTestCase(suiteOrTestId);
      switch(suiteOrTestCase.kind) {
        case "TestSuite": {
          testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: suiteOrTestId, state: 'running' });
          console.log(`Run test suite: ${suiteOrTestCase.name}, ${suiteOrTestId}`);
          for(let testCaseIdx = 0; testCaseIdx < suiteOrTestCase.testCases.length; testCaseIdx++) {
            let uniqueIdx = this.makeUniqueIndex(parseInt(suiteOrTestId), testCaseIdx);
            console.log(`Run test case: ${suiteOrTestCase.testCases[testCaseIdx].name}, ${uniqueIdx}`);
            testStatesEmitter.fire(<TestEvent>{ type: 'test', test: uniqueIdx, state: 'running' });
            testStatesEmitter.fire(<TestEvent>{ type: 'test', test: uniqueIdx, state: 'passed' });
          }
          testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: suiteOrTestId, state: 'completed' });
          break;
        }
        case "TestCase": {
          console.log(`Run test case: ${suiteOrTestCase.name}, ${suiteOrTestId}`);
          break;
        }
      }
    }
  }
};

