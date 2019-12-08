# CppUnit Test Adapter for Visual Studio Code

> Work in progress, project has just been started.

This extension aims to provide support for the [CppUnit](https://www.freedesktop.org/wiki/Software/cppunit/) test framework. The current solution is based on the XML output of a CppUnit test run. Therefore add the following configuration to your workspace settings:
```json
"cppUnitExplorer.executables": [{
  "exePath": "/path/to/the/test_exe",
  "xmlPath": "/path/to/the/results.xml"
}]
```

* There is no support for running a single test case or a single test suite. The extension always runs all test cases and only updates the selected ones in the test explorer ui.
* It is currently not possible to pass more than one executable/xml pair via the configuration value.
* Jump to file/line is only possible for failed test cases and requires a reload. This is due to the format of the CppUnit XML report.
* Added test cases/suits won't be added during a test run. This requires a reload. Removed test cases are shown as 'skipped'.

