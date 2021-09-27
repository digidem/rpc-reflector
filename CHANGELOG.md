# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
