'use strict';

//This file contains the ES6 extensions to the core Promises/A+ API

var Promise = require('./core.js');

module.exports = Promise;

/* Static Functions */

var TRUE = valuePromise(true);
var FALSE = valuePromise(false);
var NULL = valuePromise(null);
var UNDEFINED = valuePromise(undefined);
var ZERO = valuePromise(0);
var EMPTYSTRING = valuePromise('');

// 相当于新建一个 Promise，然后执行 reslove(value) 方法
function valuePromise (value) {
  var p = new Promise(Promise._noop);
  p._state = 1;
  p._value = value;
  return p;
}

// 相当于新建一个 Promise，然后执行 reslove(value) 方法
Promise.resolve = function (value) {
  if (value instanceof Promise) return value;

  if (value === null) return NULL;
  if (value === undefined) return UNDEFINED;
  if (value === true) return TRUE;
  if (value === false) return FALSE;
  if (value === 0) return ZERO;
  if (value === '') return EMPTYSTRING;

  // value 的值是 object 或 function
  if (typeof value === 'object' || typeof value === 'function') {
    try {
      var then = value.then;
      // value 有 function 函数
      if (typeof then === 'function') {
        return new Promise(then.bind(value));
      }
    } catch (ex) {
      return new Promise(function (resolve, reject) {
        reject(ex);
      });
    }
  }
  // 相当于新建一个 Promise，然后执行 reslove(value) 方法
  return valuePromise(value);
};

// 返回一个 iterable 的副本
var iterableToArray = function (iterable) {
  if (typeof Array.from === 'function') {
    // ES2015+, iterables exist
    iterableToArray = Array.from;
    return Array.from(iterable);
  }

  // ES5, only arrays and array-likes exist
  iterableToArray = function (x) { return Array.prototype.slice.call(x); };
  return Array.prototype.slice.call(iterable);
}

// 按照 arr 数组的顺序执行
Promise.all = function (arr) {

  // 返回一个 iterable 的副本 
  var args = iterableToArray(arr);

  return new Promise(function (resolve, reject) {
    if (args.length === 0) return resolve([]);

    // 剩余的元素的数量
    var remaining = args.length;

    function res (i, val) {
      // val 是 object 或 function
      if (val && (typeof val === 'object' || typeof val === 'function')) {
        // val 是 promise 类型
        if (val instanceof Promise && val.then === Promise.prototype.then) {
          // TODO: 这里 while 会造成死循环？？？
          // Anwser: 不会 self 重新被赋值为 self._value，所有不会死循环。
          // self._state === 3，说明当前 resolve(promise)方法回传的值类型为 Promise 对象，即 self._value instanceOf Promise === true， 
          // 将 self=self._value，即当前处理变更到了新的 Promise 对象上，如果当前 promise 对象内部状态是 fulfilled 或者 rejected，
          // 则直接处理 onFulfilled 或者 onRejected 回调；如果仍然是 pending 状态，则继续等待。这就很好的解释了为什么 resolve(pro1)，pro.then 的回调取的值却是 pro1._value。
          while (val._state === 3) {
            val = val._value;
          }

          // promise 类型的 val 的状态 val._state 为 1 - 满足条件 resloved(Fulfilled)，则使用 val._value
          if (val._state === 1) return res(i, val._value);

          // promise 类型的 val 的状态 val._state 为 2 - 拒绝条件 rejected，则使用 val._value
          if (val._state === 2) reject(val._value);

          // 执行 then 函数
          val.then(function (val) {
            res(i, val);
          }, reject);
          return;
        } else {
          var then = val.then;
          // 说明 val 有 then 方法
          if (typeof then === 'function') {
            var p = new Promise(then.bind(val));
            p.then(function (val) {
              res(i, val);
            }, reject);
            return;
          }
        }
      }

      // 存放对应的 args 执行的值
      args[i] = val;

      // 没有剩余的元素
      if (--remaining === 0) {
        // 调用 resolve 设置 将 promise._state 设置为 1 满足条件，promise._value=args
        resolve(args);
      }
    }

    // 按照顺序执行
    for (var i = 0; i < args.length; i++) {
      res(i, args[i]);
    }
  });
};

// 新建一个 reject 的 Promise
Promise.reject = function (value) {
  return new Promise(function (resolve, reject) {
    reject(value);
  });
};

// 返回一个 promise，一旦迭代器中的某个promise解决或拒绝，返回的 promise就会解决或拒绝。
Promise.race = function (values) {
  return new Promise(function (resolve, reject) {
    iterableToArray(values).forEach(function (value) {
      Promise.resolve(value).then(resolve, reject);
    });
  });
};

/* Prototype Methods */
// catch 方法
Promise.prototype['catch'] = function (onRejected) {
  return this.then(null, onRejected);
};
