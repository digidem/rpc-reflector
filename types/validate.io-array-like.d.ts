// Type definitions for validate.io-array-like 2.0.0
// Project: https://github.com/validate-io/array-like

declare module 'validate.io-array-like' {
  function isArrayLike(maybeArrayLike: any): maybeArrayLike is ArrayLike<any>
  export = isArrayLike
}
