'use strict';

var asap = require('asap/raw');


function noop () { }

// States:
//
// 0 - pending
// 1 - fulfilled with _value
// 2 - rejected with _value
// 3 - adopted the state of another promise, _value
//
// once the state is no longer pending (0) it is immutable

// All `_` prefixed properties will be reduced to `_{random number}`
// at build time to obfuscate them and discourage their use.
// We don't use symbols or Object.defineProperty to fully hide them
// because the performance isn't good enough.


// to avoid using try/catch inside critical functions, we
// extract them to here.
var LAST_ERROR = null;
var IS_ERROR = {};

// 参考文章：https://juejin.cn/post/6996943669248933919

// 获取 obj 对象的 then 属性值
function getThen (obj) {
  try {
    return obj.then;
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}

// 将 a 作为函数 fn 的参数执行 fn 函数
function tryCallOne (fn, a) {
  try {
    return fn(a);
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}
// 将 a、b 作为函数 fn 的参数执行 fn 函数
function tryCallTwo (fn, a, b) {
  try {
    fn(a, b);
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}

module.exports = Promise;


// Promise 构造函数
function Promise (fn) {
  if (typeof this !== 'object') {
    throw new TypeError('Promises must be constructed via new');
  }
  if (typeof fn !== 'function') {
    throw new TypeError('Promise constructor\'s argument is not a function');
  }
  // Promise 的 _deferreds 回调链表状态
  // 0 - 未进行初始化（即：_deferreds 中没有回调函数）
  // 1 - 已经进行了初始化（即：_deferreds 中有一个回调函数）
  // 2 - 已经添加了回调函数（即：_deferreds 中有 >=2 个回调函数）
  this._deferredState = 0;

  // promise 状态，可能值有：
  // 0 - 等待中 pending
  // 1 - 满足条件 resloved(Fulfilled)，值为 _value（执行了 reslove 函数）
  // 2 - 拒绝条件 rejected，值为 _value（执行了 reject 函数）
  // 3 - 采用了另一个 Promise 的状态和值
  this._state = 0;

  // 当前 promise 的值
  this._value = null;

  // 当前 promise 的回调链表
  this._deferreds = null;

  // 回调函数为 noop 空函数
  if (fn === noop) return;

  // 根据 this 的状态来执行 fn 函数
  doResolve(fn, this);
}

// 向 Promise 中注册回调函数时的全局回调函数
Promise._onHandle = null;

// reject 的全局回调函数
Promise._onReject = null;
Promise._noop = noop;


// then 函数（注册 onFulfilled、onRejected ）
Promise.prototype.then = function (onFulfilled, onRejected) {
  // 不是 Promise 对象
  if (this.constructor !== Promise) {
    return safeThen(this, onFulfilled, onRejected);
  }

  // then 的返回对象
  var res = new Promise(noop);

  // 向 self 中注册回调函数
  // 如果 promise 类型的 self._state==0 处于 pending 状态，则添加到回调链表 self._deferreds 中，等待异步执行；否则直接调用回调函数处理
  handle(this, new Handler(onFulfilled, onRejected, res));

  // 返回一个新的 Promise 对象
  return res;
};

// 
function safeThen (self, onFulfilled, onRejected) {
  // 返回一个新的 promise
  return new self.constructor(function (resolve, reject) {
    var res = new Promise(noop);

    // 
    res.then(resolve, reject);

    // 向 self 中注册回调函数
    // 如果 promise 类型的 self._state==0 处于 pending 状态，则添加到回调链表 self._deferreds 中，等待异步执行；否则直接调用回调函数处理
    handle(self, new Handler(onFulfilled, onRejected, res));
  });
}

// 向 self 中注册回调函数
// 如果 promise 类型的 self._state==0 处于 pending 状态，则添加到回调链表 self._deferreds 中，等待异步执行；否则直接使用异步方式处理回调函数
function handle (self, deferred) {
  // TODO: 这里 while 会造成死循环？？？
  // Anwser: 不会 self 重新被赋值为 self._value，所有不会死循环。
  // self._state === 3，说明当前 resolve(promise)方法回传的值类型为 Promise 对象，即 self._value instanceOf Promise === true， 
  // 将 self=self._value，即当前处理变更到了新的 Promise 对象上，如果当前 promise 对象内部状态是 fulfilled 或者 rejected，
  // 则直接处理 onFulfilled 或者 onRejected 回调；如果仍然是 pending 状态，则继续等待。这就很好的解释了为什么 resolve(pro1)，pro.then 的回调取的值却是 pro1._value。
  while (self._state === 3) {
    self = self._value;
  }

  // 向 Promise 中注册回调函数时的全局回调函数
  if (Promise._onHandle) {
    Promise._onHandle(self);
  }

  // promise 处于 pending 状态，则进行回调函数的注册
  if (self._state === 0) {
    // _deferreds 未进行初始化（即：_deferreds 中没有回调函数）
    if (self._deferredState === 0) {
      self._deferredState = 1;
      self._deferreds = deferred;
      return;
    }

    // _deferreds 已经进行了初始化（即：_deferreds 中有一个回调函数）
    if (self._deferredState === 1) {
      self._deferredState = 2;
      self._deferreds = [self._deferreds, deferred];
      return;
    }

    // _deferreds 已经添加了回调函数（即：_deferreds 中有 >=2 个回调函数）
    self._deferreds.push(deferred);
    return;
  }

  // promise 处于 resloved(Fulfilled)、reject 状态，则直接调用回调函数
  // 使用异步方式处理 self 的 deferred 回调函数
  handleResolved(self, deferred);
}

// 使用异步方式处理 self 的 deferred 回调函数
function handleResolved (self, deferred) {
  // 异步处理
  asap(function () {
    // promise 的 _state 状态，可能值有：
    // 0 - 等待中 pending
    // 1 - 满足条件 resloved(Fulfilled)，值为 _value（执行了 reslove 函数）
    // 2 - 拒绝条件 rejected，值为 _value（执行了 reject 函数）
    // 3 - 采用了另一个 Promise 的状态和值
    // 判断调用 onFulfilled 还是 onRejected 回调函数
    var cb = self._state === 1 ? deferred.onFulfilled : deferred.onRejected;
    if (cb === null) {
      if (self._state === 1) {
        // resolve 函数调用
        // 将 deferred.promise._state 设置为 1 满足条件，deferred.promise._value=newValue
        // 这里的 deferred.promise 指向的是当前 deferred 回调函数对应 then 函数的 Promise 类型的返回值
        resolve(deferred.promise, self._value);
      } else {
        // reject 函数调用
        // 设置 deferred.promise 的状态为 2 拒绝条件 rejected，值为 newValue 
        // 这里的 deferred.promise 指向的是当前 deferred 回调函数对应 then 函数的 Promise 类型的返回值
        reject(deferred.promise, self._value);
      }
      return;
    }

    // 将 a 作为函数 fn 的参数执行 fn 函数
    var ret = tryCallOne(cb, self._value);
    if (ret === IS_ERROR) { // 执行出错
      // reject 函数调用
      // 设置 deferred.promise 的状态为 2 拒绝条件 rejected，值为 newValue 
      reject(deferred.promise, LAST_ERROR);
    } else {
      // resolve 函数调用（将当前 then 函数的回调函数返回值传给 then 的 Promise._value）
      // 将 deferred.promise._state 设置为 1 满足条件，self._value=newValue   
      resolve(deferred.promise, ret);
    }
  });
}

// resolve 函数调用
// 将 self._state 设置为 1 满足条件，self._value=newValue
function resolve (self, newValue) {
  // Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
  if (newValue === self) {
    return reject(
      self,
      new TypeError('A promise cannot be resolved with itself.')
    );
  }

  // 说明 newValue 是 object、function 类型
  if (
    newValue &&
    (typeof newValue === 'object' || typeof newValue === 'function')
  ) {
    // 获取 obj 对象的 then 属性值
    var then = getThen(newValue);

    // 错误
    if (then === IS_ERROR) {
      // 设置 self 的状态为 2 拒绝条件 rejected，值为 newValue 
      return reject(self, LAST_ERROR);
    }
    if (
      then === self.then &&
      newValue instanceof Promise
    ) {
      self._state = 3;
      self._value = newValue;
      // 执行回调链表中的回调函数
      finale(self);
      return;
    } else if (typeof then === 'function') {
      // 根据 promise 的状态来执行 fn(resolve,reject) 函数
      // then.bind(newValue) 将 then 方法绑定到 newValue 对象上
      doResolve(then.bind(newValue), self);
      return;
    }
  }

  // 将 self._state 设置为 1 满足条件
  self._state = 1;
  self._value = newValue;

  // 执行回调链表中的回调函数
  finale(self);
}

// reject 函数调用
// 设置 self 的状态为 2 拒绝条件 rejected，值为 newValue 
function reject (self, newValue) {
  self._state = 2;
  self._value = newValue;

  // 存在 reject 的全局回调函数
  if (Promise._onReject) {
    Promise._onReject(self, newValue);
  }
  // 执行回调链表中的回调函数
  finale(self);
}

// 执行回调链表中的回调函数
function finale (self) {
  // self._deferreds 回调链表中只有一个回调函数
  if (self._deferredState === 1) {
    // 使用异步方式执行回调函数
    handle(self, self._deferreds);
    self._deferreds = null;
  }

  // self._deferreds 回调链表中有多个回调函数
  if (self._deferredState === 2) {
    for (var i = 0; i < self._deferreds.length; i++) {
      // 使用异步方式执行回调函数
      handle(self, self._deferreds[i]);
    }
    self._deferreds = null;
  }
}


// 回调函数的封装类型（用来封装 then 方法的回调函数）
function Handler (onFulfilled, onRejected, promise) {
  // Promise._state=1 即：状态为 resloved(Fulfilled) 时，执行的回调函数
  this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;

  // Promise._state=1 即：状态为 resloved(Fulfilled) 时，执行的回调函数
  this.onRejected = typeof onRejected === 'function' ? onRejected : null;

  // 该 then 函数的返回值（类型为 Promise）
  this.promise = promise;
}

/**
 * Take a potentially misbehaving resolver function and make sure
 * onFulfilled and onRejected are only called once.
 *
 * Makes no guarantees about asynchrony.
 */
// 根据 promise 的状态来执行 fn(resolve,reject) 函数
function doResolve (fn, promise) {
  var done = false;
  // 将 a、b 作为函数 fn 的参数执行 fn 函数
  var res = tryCallTwo(fn, function (value) { // resolve 函数(即：Promise 构造参数 fn(resolve,reject) 中的 resolve 函数)
    if (done) return;
    done = true;
    // resolve 函数调用
    // 将 promise._state 设置为 1 满足条件，promise._value=newValue
    resolve(promise, value);
  }, function (reason) { // reject 函数(即：Promise 构造函数 fn(resolve,reject) 中的 reject 函数)
    if (done) return;
    done = true;
    // reject 函数调用
    // 设置 self 的状态为 2 拒绝条件 rejected，值为 newValue 
    reject(promise, reason);
  });

  // 说明处理中产生了错误
  if (!done && res === IS_ERROR) {
    done = true;
    // reject 函数调用
    // 设置 self 的状态为 2 拒绝条件 rejected，值为 newValue 
    reject(promise, LAST_ERROR);
  }
}
