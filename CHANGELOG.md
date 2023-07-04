# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.3.5](https://github.com/gmaclennan/rpc-reflector/compare/v1.3.4...v1.3.5) (2023-07-04)

### Bug Fixes

- Fix compatibility for non-Node environments (use `readable-stream` and include `assert` as a dep) ([#14](https://github.com/gmaclennan/rpc-reflector/pull/14)) ([8b294dc](https://github.com/gmaclennan/rpc-reflector/commit/8b294dcc53e3ee2ef49994eb7415626da2b170340)))

### [1.3.4](https://github.com/gmaclennan/rpc-reflector/compare/v1.3.3...v1.3.4) (2023-06-15)

### Bug Fixes

- handle MessagePorts in electron environments ([5e0ee51](https://github.com/gmaclennan/rpc-reflector/commit/5e0ee51ed5d58d3660ea4dc5da81f96ec50a3e9b))

### [1.3.3](https://github.com/gmaclennan/rpc-reflector/compare/v1.3.2...v1.3.3) (2023-03-30)

### Bug Fixes

- Add git url to package.json ([e08e4a3](https://github.com/gmaclennan/rpc-reflector/commit/e08e4a3a38684a79cbab132eb4530147f3ec9c41))

### [1.3.2](https://github.com/gmaclennan/rpc-reflector/compare/v1.3.1...v1.3.2) (2023-03-24)

### Bug Fixes

- specify missing pump dep ([#13](https://github.com/gmaclennan/rpc-reflector/issues/13)) ([b2ba95a](https://github.com/gmaclennan/rpc-reflector/commit/b2ba95a1281d668b7fba54c37f96af7caa4e283c))

### [1.3.1](https://github.com/gmaclennan/rpc-reflector/compare/v1.3.0...v1.3.1) (2021-09-29)

### Bug Fixes

- Ensure type declarations are included in npm tarball ([248f529](https://github.com/gmaclennan/rpc-reflector/commit/248f5293ad920c96a1ab0ee19d060958e8acb645))

## [1.3.0](https://github.com/gmaclennan/rpc-reflector/compare/v1.2.0...v1.3.0) (2021-09-29)

### Features

- Publish Typescript typings to npm ([e73c87e](https://github.com/gmaclennan/rpc-reflector/commit/e73c87ef33b44d490ee33b8656f67240556cdb63))

## [1.2.0](https://github.com/gmaclennan/rpc-reflector/compare/v1.1.0...v1.2.0) (2021-09-27)

### Features

- Strictly-typed client API from the server API type ([7f8117b](https://github.com/gmaclennan/rpc-reflector/commit/7f8117bfc58a762b184b8e273547e9be74d5c950))

## 1.1.0 (2021-09-24)

### Features

- Add encode-decode stream ([ac87e0a](https://github.com/gmaclennan/rpc-reflector/commit/ac87e0aee7ca2acab9b4ab546bb3740d2ab594d8))
- Support calling nested props ([ccf09f5](https://github.com/gmaclennan/rpc-reflector/commit/ccf09f574518cbca6370d8a26a16b97def038134))
- Support MessagePort and MessagePort-like as well as Duplex stream ([796e4c1](https://github.com/gmaclennan/rpc-reflector/commit/796e4c1d346281ce5639c85f80dd0d18580369a4))
- Support nested EventEmitters ([c457ba1](https://github.com/gmaclennan/rpc-reflector/commit/c457ba1f72e3155c1d4efc041c97dd0e4ad16582))
- Support reading properties via async methods with same name ([0b7b920](https://github.com/gmaclennan/rpc-reflector/commit/0b7b9205df46829b962c2f81f70e57232f6fb0a9))

### Bug Fixes

- Fix objectMode stream support ([c772ec0](https://github.com/gmaclennan/rpc-reflector/commit/c772ec09ddab31915943467df0c90bc28c9cd15f))
- Support backpressure for readableStream methods on api ([fc3a718](https://github.com/gmaclennan/rpc-reflector/commit/fc3a7184a146863f47e830a552accc573437f264))
