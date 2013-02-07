( // Module boilerplate to support browser globals and AMD.
  (typeof define === "function" && function (m) { define("msgpack-js", m); }) ||
  (function (m) { window.msgpack = m(); })
)(function () {
"use strict";

var exports = {};

exports.inspect = inspect;
function inspect(buffer) {
  if (buffer === undefined) return "undefined";
  var view;
  var type;
  if (buffer instanceof ArrayBuffer) {
    type = "ArrayBuffer";
    view = new DataView(buffer);
  }
  else if (buffer instanceof DataView) {
    type = "DataView";
    view = buffer;
  }
  if (!view) return JSON.stringify(buffer);
  var bytes = [];
  for (var i = 0; i < buffer.byteLength; i++) {
    if (i > 20) {
      bytes.push("...");
      break;
    }
    var byte = view.getUint8(i).toString(16);
    if (byte.length === 1) byte = "0" + byte;
    bytes.push(byte);
  }
  return "<" + type + " " + bytes.join(" ") + ">";
}

// Encode string as utf8 into dataview at offset
exports.utf8Write = utf8Write;
function utf8Write(view, offset, string) {
  var byteLength = view.byteLength;
  for(var i = 0, l = string.length; i < l; i++) {
    var codePoint = string.charCodeAt(i);

    // One byte of UTF-8
    if (codePoint < 0x80) {
      view.setUint8(offset++, codePoint >>> 0 & 0x7f | 0x00);
      continue;
    }

    // Two bytes of UTF-8
    if (codePoint < 0x800) {
      view.setUint8(offset++, codePoint >>> 6 & 0x1f | 0xc0);
      view.setUint8(offset++, codePoint >>> 0 & 0x3f | 0x80);
      continue;
    }

    // Three bytes of UTF-8.  
    if (codePoint < 0x10000) {
      view.setUint8(offset++, codePoint >>> 12 & 0x0f | 0xe0);
      view.setUint8(offset++, codePoint >>> 6  & 0x3f | 0x80);
      view.setUint8(offset++, codePoint >>> 0  & 0x3f | 0x80);
      continue;
    }

    // Four bytes of UTF-8
    if (codePoint < 0x110000) {
      view.setUint8(offset++, codePoint >>> 18 & 0x07 | 0xf0);
      view.setUint8(offset++, codePoint >>> 12 & 0x3f | 0x80);
      view.setUint8(offset++, codePoint >>> 6  & 0x3f | 0x80);
      view.setUint8(offset++, codePoint >>> 0  & 0x3f | 0x80);
      continue;
    }
    throw new Error("bad codepoint " + codePoint);
  }
}

exports.utf8Read = utf8Read;
function utf8Read(view, offset, length) {
  var string = "";
  for (var i = offset, end = offset + length; i < end; i++) {
    var byte = view.getUint8(i);
    // One byte character
    if ((byte & 0x80) === 0x00) {
      string += String.fromCharCode(byte);
      continue;
    }
    // Two byte character
    if ((byte & 0xe0) === 0xc0) {
      string += String.fromCharCode(
        ((byte & 0x0f) << 6) | 
        (view.getUint8(++i) & 0x3f)
      );
      continue;
    }
    // Three byte character
    if ((byte & 0xf0) === 0xe0) {
      string += String.fromCharCode(
        ((byte & 0x0f) << 12) |
        ((view.getUint8(++i) & 0x3f) << 6) |
        ((view.getUint8(++i) & 0x3f) << 0)
      );
      continue;
    }
    // Four byte character
    if ((byte & 0xf8) === 0xf0) {
      string += String.fromCharCode(
        ((byte & 0x07) << 18) |
        ((view.getUint8(++i) & 0x3f) << 12) |
        ((view.getUint8(++i) & 0x3f) << 6) |
        ((view.getUint8(++i) & 0x3f) << 0)
      );
      continue;
    }
    throw new Error("Invalid byte " + byte.toString(16));
  }
  return string;
}

exports.utf8ByteCount = utf8ByteCount;
function utf8ByteCount(string) {
  var count = 0;
  for(var i = 0, l = string.length; i < l; i++) {
    var codePoint = string.charCodeAt(i);
    if (codePoint < 0x80) {
      count += 1;
      continue;
    }
    if (codePoint < 0x800) {
      count += 2;
      continue;
    }
    if (codePoint < 0x10000) {
      count += 3;
      continue;
    }
    if (codePoint < 0x110000) {
      count += 4;
      continue;
    }
    throw new Error("bad codepoint " + codePoint);
  }
  return count;
}

exports.encode = function (value) {
  var buffer = new ArrayBuffer(sizeof(value));
  var view = new DataView(buffer);
  encode(value, view, 0);
  return buffer;
}

exports.decode = decode;

// http://wiki.msgpack.org/display/MSGPACK/Format+specification
// I've extended the protocol to have two new types that were previously reserved.
//   buffer 16  11011000  0xd8
//   buffer 32  11011001  0xd9
// These work just like raw16 and raw32 except they are node buffers instead of strings.
//
// Also I've added a type for `undefined`
//   undefined  11000100  0xc4

function Decoder(view, offset) {
  this.offset = offset || 0;
  this.view = view;
}
Decoder.prototype.map = function (length) {
  var value = {};
  for (var i = 0; i < length; i++) {
    var key = this.parse();
    value[key] = this.parse();
  }
  return value;
};
Decoder.prototype.buf = function (length) {
  var value = new ArrayBuffer(length);
  (new Uint8Array(value)).set(new Uint8Array(this.view.buffer, this.offset, length), 0);
  this.offset += length;
  return value;
};
Decoder.prototype.raw = function (length) {
  var value = utf8Read(this.view, this.offset, length);
  this.offset += length;
  return value;
};
Decoder.prototype.array = function (length) {
  var value = new Array(length);
  for (var i = 0; i < length; i++) {
    value[i] = this.parse();
  }
  return value;
};
Decoder.prototype.parse = function () {
  var type = this.view.getUint8(this.offset);
  var value, length;
  // FixRaw
  if ((type & 0xe0) === 0xa0) {
    length = type & 0x1f;
    this.offset++;
    return this.raw(length);
  }
  // FixMap
  if ((type & 0xf0) === 0x80) {
    length = type & 0x0f;
    this.offset++;
    return this.map(length);
  }
  // FixArray
  if ((type & 0xf0) === 0x90) {
    length = type & 0x0f;
    this.offset++;
    return this.array(length);
  }
  // Positive FixNum
  if ((type & 0x80) === 0x00) {
    this.offset++;
    return type;
  }
  // Negative Fixnum
  if ((type & 0xe0) === 0xe0) {
    value = this.view.getInt8(this.offset);
    this.offset++;
    return value;
  }
  switch (type) {
  // raw 16
  case 0xda:
    length = this.view.getUint16(this.offset + 1);
    this.offset += 3;
    return this.raw(length);
  // raw 32
  case 0xdb:
    length = this.view.getUint32(this.offset + 1);
    this.offset += 5;
    return this.raw(length);
  // nil
  case 0xc0:
    this.offset++;
    return null;
  // false
  case 0xc2:
    this.offset++;
    return false;
  // true
  case 0xc3:
    this.offset++;
    return true;
  // undefined
  case 0xc4:
    this.offset++;
    return undefined;
  // uint8
  case 0xcc:
    value = this.view.getUint8(this.offset + 1);
    this.offset += 2;
    return value;
  // uint 16
  case 0xcd:
    value = this.view.getUint16(this.offset + 1);
    this.offset += 3;
    return value;
  // uint 32
  case 0xce:
    value = this.view.getUint32(this.offset + 1);
    this.offset += 5;
    return value;
  // int 8
  case 0xd0:
    value = this.view.getInt8(this.offset + 1);
    this.offset += 2;
    return value;
  // int 16
  case 0xd1:
    value = this.view.getInt16(this.offset + 1);
    this.offset += 3;
    return value;
  // int 32
  case 0xd2:
    value = this.view.getInt32(this.offset + 1);
    this.offset += 5;
    return value;
  // map 16
  case 0xde:
    length = this.view.getUint16(this.offset + 1);
    this.offset += 3;
    return this.map(length);
  // map 32
  case 0xdf:
    length = this.view.getUint32(this.offset + 1);
    this.offset += 5;
    return this.map(length);
  // array 16
  case 0xdc:
    length = this.view.getUint16(this.offset + 1);
    this.offset += 3;
    return this.array(length);
  // array 32
  case 0xdd:
    length = this.view.getUint32(this.offset + 1);
    this.offset += 5;
    return this.array(length);
  // buffer 16
  case 0xd8:
    length = this.view.getUint16(this.offset + 1);
    this.offset += 3;
    return this.buf(length);
  // buffer 32
  case 0xd9:
    length = this.view.getUint32(this.offset + 1);
    this.offset += 5;
    return this.buf(length);
  // float
  case 0xca:
    value = this.view.getFloat32(this.offset + 1);
    this.offset += 5;
    return value;
  // double
  case 0xcb:
    value = this.view.getFloat64(this.offset + 1);
    this.offset += 9;
    return value;
  }
  throw new Error("Unknown type 0x" + type.toString(16));
};
function decode(buffer) {
  var view = new DataView(buffer);
  var decoder = new Decoder(view);
  var value = decoder.parse();
  if (decoder.offset !== buffer.byteLength) throw new Error((buffer.byteLength - decoder.offset) + " trailing bytes");
  return value;
}

function encode(value, view, offset) {
  var type = typeof value;

  // Strings Bytes
  if (type === "string") {
    var length = utf8ByteCount(value);
    // fix raw
    if (length < 0x20) {
      view.setUint8(offset, length | 0xa0);
      utf8Write(view, offset + 1, value);
      return 1 + length;
    }
    // raw 16
    if (length < 0x10000) {
      view.setUint8(offset, 0xda);
      view.setUint16(offset + 1, length);
      utf8Write(view, offset + 3, value);
      return 3 + length;
    }
    // raw 32
    if (length < 0x100000000) {
      view.setUint8(offset, 0xdb);
      view.setUint32(offset + 1, length);
      utf8Write(view, offset + 5, value);
      return 5 + length;
    }
  }

  if (value instanceof ArrayBuffer) {
    var length = value.byteLength;
    // buffer 16
    if (length < 0x10000) {
      view.setUint8(offset, 0xd8);
      view.setUint16(offset + 1, length);
      (new Uint8Array(view.buffer)).set(new Uint8Array(value), offset + 3);
      return 3 + length;
    }
    // buffer 32
    if (length < 0x100000000) {
      view.setUint8(offset, 0xd9);
      view.setUint32(offset + 1, length);
      (new Uint8Array(view.buffer)).set(new Uint8Array(value), offset + 5);
      return 5 + length;
    }
  }
  
  if (type === "number") {
    // Floating Point
    if ((value << 0) !== value) {
      view.setUint8(offset, 0xcb);
      view.setFloat64(offset + 1, value);
      return 9;
    }

    // Integers
    if (value >=0) {
      // positive fixnum
      if (value < 0x80) {
        view.setUint8(offset, value);
        return 1;
      }
      // uint 8
      if (value < 0x100) {
        view.setUint8(offset, 0xcc);
        view.setUint8(offset + 1, value);
        return 2;
      }
      // uint 16
      if (value < 0x10000) {
        view.setUint8(offset, 0xcd);
        view.setUint16(offset + 1, value);
        return 3;
      }
      // uint 32
      if (value < 0x100000000) {
        view.setUint8(offset, 0xce);
        view.setUint32(offset + 1, value);
        return 5;
      }
      throw new Error("Number too big 0x" + value.toString(16));
    }
    // negative fixnum
    if (value >= -0x20) {
      view.setInt8(offset, value);
      return 1;
    }
    // int 8
    if (value >= -0x80) {
      view.setUint8(offset, 0xd0);
      view.setInt8(offset + 1, value);
      return 2;
    }
    // int 16
    if (value >= -0x8000) {
      view.setUint8(offset, 0xd1);
      view.setInt16(offset + 1, value);
      return 3;
    }
    // int 32
    if (value >= -0x80000000) {
      view.setUint8(offset, 0xd2);
      view.setInt32(offset + 1, value);
      return 5;
    }
    throw new Error("Number too small -0x" + (-value).toString(16).substr(1));
  }
  
  // undefined
  if (type === "undefined") {
    view.setUint8(offset, 0xc4);
    return 1;
  }
  
  // null
  if (value === null) {
    view.setUint8(offset, 0xc0);
    return 1;
  }

  // Boolean
  if (type === "boolean") {
    view.setUint8(offset, value ? 0xc3 : 0xc2);
    return 1;
  }
  
  // Container Types
  if (type === "object") {
    var length, size = 0;
    var isArray = Array.isArray(value);

    if (isArray) {
      length = value.length;
    }
    else {
      var keys = Object.keys(value);
      length = keys.length;
    }

    var size;
    if (length < 0x10) {
      view.setUint8(offset, length | (isArray ? 0x90 : 0x80));
      size = 1;
    }
    else if (length < 0x10000) {
      view.setUint8(offset, isArray ? 0xdc : 0xde);
      view.setUint16(offset + 1, length);
      size = 3;
    }
    else if (length < 0x100000000) {
      view.setUint8(offset, isArray ? 0xdd : 0xdf);
      view.setUint32(offset + 1, length);
      size = 5;
    }

    if (isArray) {
      for (var i = 0; i < length; i++) {
        size += encode(value[i], view, offset + size);
      }
    }
    else {
      for (var i = 0; i < length; i++) {
        var key = keys[i];
        size += encode(key, view, offset + size);
        size += encode(value[key], view, offset + size);
      }
    }
    
    return size;
  }
  throw new Error("Unknown type " + type);
}

function sizeof(value) {
  var type = typeof value;

  // Raw Bytes
  if (type === "string") {
    var length = utf8ByteCount(value);
    if (length < 0x20) {
      return 1 + length;
    }
    if (length < 0x10000) {
      return 3 + length;
    }
    if (length < 0x100000000) {
      return 5 + length;
    }
  }
  
  if (value instanceof ArrayBuffer) {
    var length = value.byteLength;
    if (length < 0x10000) {
      return 3 + length;
    }
    if (length < 0x100000000) {
      return 5 + length;
    }
  }
  
  if (type === "number") {
    // Floating Point
    // double
    if (value << 0 !== value) return 9;

    // Integers
    if (value >=0) {
      // positive fixnum
      if (value < 0x80) return 1;
      // uint 8
      if (value < 0x100) return 2;
      // uint 16
      if (value < 0x10000) return 3;
      // uint 32
      if (value < 0x100000000) return 5;
      // uint 64
      if (value < 0x10000000000000000) return 9;
      throw new Error("Number too big 0x" + value.toString(16));
    }
    // negative fixnum
    if (value >= -0x20) return 1;
    // int 8
    if (value >= -0x80) return 2;
    // int 16
    if (value >= -0x8000) return 3;
    // int 32
    if (value >= -0x80000000) return 5;
    // int 64
    if (value >= -0x8000000000000000) return 9;
    throw new Error("Number too small -0x" + value.toString(16).substr(1));
  }
  
  // Boolean, null, undefined
  if (type === "boolean" || type === "undefined" || value === null) return 1;
  
  // Container Types
  if (type === "object") {
    var length, size = 0;
    if (Array.isArray(value)) {
      length = value.length;
      for (var i = 0; i < length; i++) {
        size += sizeof(value[i]);
      }
    }
    else {
      var keys = Object.keys(value);
      length = keys.length;
      for (var i = 0; i < length; i++) {
        var key = keys[i];
        size += sizeof(key) + sizeof(value[key]);
      }
    }
    if (length < 0x10) {
      return 1 + size;
    }
    if (length < 0x10000) {
      return 3 + size;
    }
    if (length < 0x100000000) {
      return 5 + size;
    }
    throw new Error("Array or object too long 0x" + length.toString(16));
  }
  throw new Error("Unknown type " + type);
}

return exports;

});

(function(){function A(a,b,c){if(a===b)return a!==0||1/a==1/b;if(a==null||b==null)return a===b;a._chain&&(a=a._wrapped),b._chain&&(b=b._wrapped);if(a.isEqual&&w.isFunction(a.isEqual))return a.isEqual(b);if(b.isEqual&&w.isFunction(b.isEqual))return b.isEqual(a);var d=i.call(a);if(d!=i.call(b))return!1;switch(d){case"[object String]":return a==String(b);case"[object Number]":return a!=+a?b!=+b:a==0?1/a==1/b:a==+b;case"[object Date]":case"[object Boolean]":return+a==+b;case"[object RegExp]":return a.source==b.source&&a.global==b.global&&a.multiline==b.multiline&&a.ignoreCase==b.ignoreCase}if(typeof a!="object"||typeof b!="object")return!1;var e=c.length;while(e--)if(c[e]==a)return!0;c.push(a);var f=0,g=!0;if(d=="[object Array]"){f=a.length,g=f==b.length;if(g)while(f--)if(!(g=f in a==f in b&&A(a[f],b[f],c)))break}else{if("constructor"in a!="constructor"in b||a.constructor!=b.constructor)return!1;for(var h in a)if(w.has(a,h)){f++;if(!(g=w.has(b,h)&&A(a[h],b[h],c)))break}if(g){for(h in b)if(w.has(b,h)&&!(f--))break;g=!f}}return c.pop(),g}var a=this,b=a._,c={},d=Array.prototype,e=Object.prototype,f=Function.prototype,g=d.slice,h=d.unshift,i=e.toString,j=e.hasOwnProperty,k=d.forEach,l=d.map,m=d.reduce,n=d.reduceRight,o=d.filter,p=d.every,q=d.some,r=d.indexOf,s=d.lastIndexOf,t=Array.isArray,u=Object.keys,v=f.bind,w=function(a){return new I(a)};typeof exports!="undefined"?(typeof module!="undefined"&&module.exports&&(exports=module.exports=w),exports._=w):a._=w,w.VERSION="1.3.3";var x=w.each=w.forEach=function(a,b,d){if(a==null)return;if(k&&a.forEach===k)a.forEach(b,d);else if(a.length===+a.length){for(var e=0,f=a.length;e<f;e++)if(e in a&&b.call(d,a[e],e,a)===c)return}else for(var g in a)if(w.has(a,g)&&b.call(d,a[g],g,a)===c)return};w.map=w.collect=function(a,b,c){var d=[];return a==null?d:l&&a.map===l?a.map(b,c):(x(a,function(a,e,f){d[d.length]=b.call(c,a,e,f)}),a.length===+a.length&&(d.length=a.length),d)},w.reduce=w.foldl=w.inject=function(a,b,c,d){var e=arguments.length>2;a==null&&(a=[]);if(m&&a.reduce===m)return d&&(b=w.bind(b,d)),e?a.reduce(b,c):a.reduce(b);x(a,function(a,f,g){e?c=b.call(d,c,a,f,g):(c=a,e=!0)});if(!e)throw new TypeError("Reduce of empty array with no initial value");return c},w.reduceRight=w.foldr=function(a,b,c,d){var e=arguments.length>2;a==null&&(a=[]);if(n&&a.reduceRight===n)return d&&(b=w.bind(b,d)),e?a.reduceRight(b,c):a.reduceRight(b);var f=w.toArray(a).reverse();return d&&!e&&(b=w.bind(b,d)),e?w.reduce(f,b,c,d):w.reduce(f,b)},w.find=w.detect=function(a,b,c){var d;return y(a,function(a,e,f){if(b.call(c,a,e,f))return d=a,!0}),d},w.filter=w.select=function(a,b,c){var d=[];return a==null?d:o&&a.filter===o?a.filter(b,c):(x(a,function(a,e,f){b.call(c,a,e,f)&&(d[d.length]=a)}),d)},w.reject=function(a,b,c){var d=[];return a==null?d:(x(a,function(a,e,f){b.call(c,a,e,f)||(d[d.length]=a)}),d)},w.every=w.all=function(a,b,d){var e=!0;return a==null?e:p&&a.every===p?a.every(b,d):(x(a,function(a,f,g){if(!(e=e&&b.call(d,a,f,g)))return c}),!!e)};var y=w.some=w.any=function(a,b,d){b||(b=w.identity);var e=!1;return a==null?e:q&&a.some===q?a.some(b,d):(x(a,function(a,f,g){if(e||(e=b.call(d,a,f,g)))return c}),!!e)};w.include=w.contains=function(a,b){var c=!1;return a==null?c:r&&a.indexOf===r?a.indexOf(b)!=-1:(c=y(a,function(a){return a===b}),c)},w.invoke=function(a,b){var c=g.call(arguments,2);return w.map(a,function(a){return(w.isFunction(b)?b||a:a[b]).apply(a,c)})},w.pluck=function(a,b){return w.map(a,function(a){return a[b]})},w.max=function(a,b,c){if(!b&&w.isArray(a)&&a[0]===+a[0])return Math.max.apply(Math,a);if(!b&&w.isEmpty(a))return-Infinity;var d={computed:-Infinity};return x(a,function(a,e,f){var g=b?b.call(c,a,e,f):a;g>=d.computed&&(d={value:a,computed:g})}),d.value},w.min=function(a,b,c){if(!b&&w.isArray(a)&&a[0]===+a[0])return Math.min.apply(Math,a);if(!b&&w.isEmpty(a))return Infinity;var d={computed:Infinity};return x(a,function(a,e,f){var g=b?b.call(c,a,e,f):a;g<d.computed&&(d={value:a,computed:g})}),d.value},w.shuffle=function(a){var b=[],c;return x(a,function(a,d,e){c=Math.floor(Math.random()*(d+1)),b[d]=b[c],b[c]=a}),b},w.sortBy=function(a,b,c){var d=w.isFunction(b)?b:function(a){return a[b]};return w.pluck(w.map(a,function(a,b,e){return{value:a,criteria:d.call(c,a,b,e)}}).sort(function(a,b){var c=a.criteria,d=b.criteria;return c===void 0?1:d===void 0?-1:c<d?-1:c>d?1:0}),"value")},w.groupBy=function(a,b){var c={},d=w.isFunction(b)?b:function(a){return a[b]};return x(a,function(a,b){var e=d(a,b);(c[e]||(c[e]=[])).push(a)}),c},w.sortedIndex=function(a,b,c){c||(c=w.identity);var d=0,e=a.length;while(d<e){var f=d+e>>1;c(a[f])<c(b)?d=f+1:e=f}return d},w.toArray=function(a){return a?w.isArray(a)?g.call(a):w.isArguments(a)?g.call(a):a.toArray&&w.isFunction(a.toArray)?a.toArray():w.values(a):[]},w.size=function(a){return w.isArray(a)?a.length:w.keys(a).length},w.first=w.head=w.take=function(a,b,c){return b!=null&&!c?g.call(a,0,b):a[0]},w.initial=function(a,b,c){return g.call(a,0,a.length-(b==null||c?1:b))},w.last=function(a,b,c){return b!=null&&!c?g.call(a,Math.max(a.length-b,0)):a[a.length-1]},w.rest=w.tail=function(a,b,c){return g.call(a,b==null||c?1:b)},w.compact=function(a){return w.filter(a,function(a){return!!a})},w.flatten=function(a,b){return w.reduce(a,function(a,c){return w.isArray(c)?a.concat(b?c:w.flatten(c)):(a[a.length]=c,a)},[])},w.without=function(a){return w.difference(a,g.call(arguments,1))},w.uniq=w.unique=function(a,b,c){var d=c?w.map(a,c):a,e=[];return a.length<3&&(b=!0),w.reduce(d,function(c,d,f){if(b?w.last(c)!==d||!c.length:!w.include(c,d))c.push(d),e.push(a[f]);return c},[]),e},w.union=function(){return w.uniq(w.flatten(arguments,!0))},w.intersection=w.intersect=function(a){var b=g.call(arguments,1);return w.filter(w.uniq(a),function(a){return w.every(b,function(b){return w.indexOf(b,a)>=0})})},w.difference=function(a){var b=w.flatten(g.call(arguments,1),!0);return w.filter(a,function(a){return!w.include(b,a)})},w.zip=function(){var a=g.call(arguments),b=w.max(w.pluck(a,"length")),c=new Array(b);for(var d=0;d<b;d++)c[d]=w.pluck(a,""+d);return c},w.indexOf=function(a,b,c){if(a==null)return-1;var d,e;if(c)return d=w.sortedIndex(a,b),a[d]===b?d:-1;if(r&&a.indexOf===r)return a.indexOf(b);for(d=0,e=a.length;d<e;d++)if(d in a&&a[d]===b)return d;return-1},w.lastIndexOf=function(a,b){if(a==null)return-1;if(s&&a.lastIndexOf===s)return a.lastIndexOf(b);var c=a.length;while(c--)if(c in a&&a[c]===b)return c;return-1},w.range=function(a,b,c){arguments.length<=1&&(b=a||0,a=0),c=arguments[2]||1;var d=Math.max(Math.ceil((b-a)/c),0),e=0,f=new Array(d);while(e<d)f[e++]=a,a+=c;return f};var z=function(){};w.bind=function(a,b){var c,d;if(a.bind===v&&v)return v.apply(a,g.call(arguments,1));if(!w.isFunction(a))throw new TypeError;return d=g.call(arguments,2),c=function(){if(this instanceof c){z.prototype=a.prototype;var e=new z,f=a.apply(e,d.concat(g.call(arguments)));return Object(f)===f?f:e}return a.apply(b,d.concat(g.call(arguments)))}},w.bindAll=function(a){var b=g.call(arguments,1);return b.length==0&&(b=w.functions(a)),x(b,function(b){a[b]=w.bind(a[b],a)}),a},w.memoize=function(a,b){var c={};return b||(b=w.identity),function(){var d=b.apply(this,arguments);return w.has(c,d)?c[d]:c[d]=a.apply(this,arguments)}},w.delay=function(a,b){var c=g.call(arguments,2);return setTimeout(function(){return a.apply(null,c)},b)},w.defer=function(a){return w.delay.apply(w,[a,1].concat(g.call(arguments,1)))},w.throttle=function(a,b){var c,d,e,f,g,h,i=w.debounce(function(){g=f=!1},b);return function(){c=this,d=arguments;var j=function(){e=null,g&&a.apply(c,d),i()};return e||(e=setTimeout(j,b)),f?g=!0:h=a.apply(c,d),i(),f=!0,h}},w.debounce=function(a,b,c){var d;return function(){var e=this,f=arguments,g=function(){d=null,c||a.apply(e,f)};c&&!d&&a.apply(e,f),clearTimeout(d),d=setTimeout(g,b)}},w.once=function(a){var b=!1,c;return function(){return b?c:(b=!0,c=a.apply(this,arguments))}},w.wrap=function(a,b){return function(){var c=[a].concat(g.call(arguments,0));return b.apply(this,c)}},w.compose=function(){var a=arguments;return function(){var b=arguments;for(var c=a.length-1;c>=0;c--)b=[a[c].apply(this,b)];return b[0]}},w.after=function(a,b){return a<=0?b():function(){if(--a<1)return b.apply(this,arguments)}},w.keys=u||function(a){if(a!==Object(a))throw new TypeError("Invalid object");var b=[];for(var c in a)w.has(a,c)&&(b[b.length]=c);return b},w.values=function(a){return w.map(a,w.identity)},w.functions=w.methods=function(a){var b=[];for(var c in a)w.isFunction(a[c])&&b.push(c);return b.sort()},w.extend=function(a){return x(g.call(arguments,1),function(b){for(var c in b)a[c]=b[c]}),a},w.pick=function(a){var b={};return x(w.flatten(g.call(arguments,1)),function(c){c in a&&(b[c]=a[c])}),b},w.defaults=function(a){return x(g.call(arguments,1),function(b){for(var c in b)a[c]==null&&(a[c]=b[c])}),a},w.clone=function(a){return w.isObject(a)?w.isArray(a)?a.slice():w.extend({},a):a},w.tap=function(a,b){return b(a),a},w.isEqual=function(a,b){return A(a,b,[])},w.isEmpty=function(a){if(a==null)return!0;if(w.isArray(a)||w.isString(a))return a.length===0;for(var b in a)if(w.has(a,b))return!1;return!0},w.isElement=function(a){return!!a&&a.nodeType==1},w.isArray=t||function(a){return i.call(a)=="[object Array]"},w.isObject=function(a){return a===Object(a)},w.isArguments=function(a){return i.call(a)=="[object Arguments]"},w.isArguments(arguments)||(w.isArguments=function(a){return!!a&&!!w.has(a,"callee")}),w.isFunction=function(a){return i.call(a)=="[object Function]"},w.isString=function(a){return i.call(a)=="[object String]"},w.isNumber=function(a){return i.call(a)=="[object Number]"},w.isFinite=function(a){return w.isNumber(a)&&isFinite(a)},w.isNaN=function(a){return a!==a},w.isBoolean=function(a){return a===!0||a===!1||i.call(a)=="[object Boolean]"},w.isDate=function(a){return i.call(a)=="[object Date]"},w.isRegExp=function(a){return i.call(a)=="[object RegExp]"},w.isNull=function(a){return a===null},w.isUndefined=function(a){return a===void 0},w.has=function(a,b){return j.call(a,b)},w.noConflict=function(){return a._=b,this},w.identity=function(a){return a},w.times=function(a,b,c){for(var d=0;d<a;d++)b.call(c,d)},w.escape=function(a){return(""+a).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;").replace(/\//g,"&#x2F;")},w.result=function(a,b){if(a==null)return null;var c=a[b];return w.isFunction(c)?c.call(a):c},w.mixin=function(a){x(w.functions(a),function(b){K(b,w[b]=a[b])})};var B=0;w.uniqueId=function(a){var b=B++;return a?a+b:b},w.templateSettings={evaluate:/<%([\s\S]+?)%>/g,interpolate:/<%=([\s\S]+?)%>/g,escape:/<%-([\s\S]+?)%>/g};var C=/.^/,D={"\\":"\\","'":"'",r:"\r",n:"\n",t:"\t",u2028:"\u2028",u2029:"\u2029"};for(var E in D)D[D[E]]=E;var F=/\\|'|\r|\n|\t|\u2028|\u2029/g,G=/\\(\\|'|r|n|t|u2028|u2029)/g,H=function(a){return a.replace(G,function(a,b){return D[b]})};w.template=function(a,b,c){c=w.defaults(c||{},w.templateSettings);var d="__p+='"+a.replace(F,function(a){return"\\"+D[a]}).replace(c.escape||C,function(a,b){return"'+\n_.escape("+H(b)+")+\n'"}).replace(c.interpolate||C,function(a,b){return"'+\n("+H(b)+")+\n'"}).replace(c.evaluate||C,function(a,b){return"';\n"+H(b)+"\n;__p+='"})+"';\n";c.variable||(d="with(obj||{}){\n"+d+"}\n"),d="var __p='';var print=function(){__p+=Array.prototype.join.call(arguments, '')};\n"+d+"return __p;\n";var e=new Function(c.variable||"obj","_",d);if(b)return e(b,w);var f=function(a){return e.call(this,a,w)};return f.source="function("+(c.variable||"obj")+"){\n"+d+"}",f},w.chain=function(a){return w(a).chain()};var I=function(a){this._wrapped=a};w.prototype=I.prototype;var J=function(a,b){return b?w(a).chain():a},K=function(a,b){I.prototype[a]=function(){var a=g.call(arguments);return h.call(a,this._wrapped),J(b.apply(w,a),this._chain)}};w.mixin(w),x(["pop","push","reverse","shift","sort","splice","unshift"],function(a){var b=d[a];I.prototype[a]=function(){var c=this._wrapped;b.apply(c,arguments);var d=c.length;return(a=="shift"||a=="splice")&&d===0&&delete c[0],J(c,this._chain)}}),x(["concat","join","slice"],function(a){var b=d[a];I.prototype[a]=function(){return J(b.apply(this._wrapped,arguments),this._chain)}}),I.prototype.chain=function(){return this._chain=!0,this},I.prototype.value=function(){return this._wrapped}}).call(this),function(a){if(typeof define=="function")define(a);else if(typeof exports=="object")a(void 0,exports);else if(typeof ses!="undefined"){if(!ses.ok())return;ses.makeQ=function(){var b={};return a(void 0,b)}}else a(void 0,Q={})}(function(a,b){function r(a){return q(a)==="[object StopIteration]"||a instanceof s}function t(a,b){var c=[];try{c.push(a.toString())}catch(d){try{c.push("<error: "+d+">")}catch(e){c.push("<error>")}}for(var f=0;f<b.length;f++){var g=b[f],h;if(typeof g=="string")c.push(g);else{try{h=u(g)}catch(d){try{h="<error: "+d+">"}catch(e){h="<error>"}}c.push("    at "+h)}}return c.join("\n")}function u(a){var b="";if(a.isNative())b="native";else if(a.isEval())b="eval at "+a.getEvalOrigin();else{var c=a.getFileName();if(c){b+=c;var d=a.getLineNumber();if(d!==null){b+=":"+d;var e=a.getColumnNumber();e&&(b+=":"+e)}}}b||(b="unknown source");var f="",g=a.getFunction().name,h=!0,i=a.isConstructor(),j=!a.isToplevel()&&!i;if(j){var k=a.getMethodName();f+=a.getTypeName()+".",g?(f+=g,k&&k!==g&&(f+=" [as "+k+"]")):f+=k||"<anonymous>"}else i?f+="new "+(g||"<anonymous>"):g?f+=g:(f+=b,h=!1);return h&&(f+=" ("+b+")"),f}function v(a,b){if(a!==x)return!1;var c=b.getLineNumber();return c>=y&&c<=z}function w(a){var b=Error.prepareStackTrace;Error.prepareStackTrace=function(a,b){return b.filter(function(a){var b=a.getFileName();return b!=="module.js"&&b!=="node.js"&&!v(b,a)})};var c=a.stack;return Error.prepareStackTrace=b,c}function A(a){if(Error.captureStackTrace){var b,c,d=Error.prepareStackTrace;Error.prepareStackTrace=function(a,d){b=d[0].getFileName(),c=d[0].getLineNumber()},a.stack,Error.prepareStackTrace=d,x=b,y?z=c:y=c}}function B(a,b,c){return function(){return typeof console!="undefined"&&typeof console.warn=="function"&&console.warn(b+" is deprecated, use "+c+" instead."),a.apply(a,arguments)}}function C(){function g(c){if(!a)return;return b=N(c),l(a,function(a,c){e(function(){b.promiseSend.apply(b,c)})},void 0),a=void 0,b}var a=[],b,c=o(C.prototype),f=o(E.prototype);return f.promiseSend=function(){var c=k(arguments);a?a.push(c):e(function(){b.promiseSend.apply(b,c)})},f.valueOf=function(){return a?f:b.valueOf()},Error.captureStackTrace&&Error.captureStackTrace(f,C),d(f),c.promise=f,c.resolve=g,c.reject=function(a){return g(M(a))},c}function D(a){var b=C();return bb(a,void 0,b.resolve,b.reject).fail(b.reject),b.promise}function E(a,b,c,e){b===void 0&&(b=function(a){return M(new Error("Promise does not support operation: "+a))});var f=o(E.prototype);return f.promiseSend=function(c,d){var e=k(arguments,2),g;try{a[c]?g=a[c].apply(f,e):g=b.apply(f,[c].concat(e))}catch(h){g=M(h)}d(g)},c&&(f.valueOf=c),e&&(f.exception=e),d(f),f}function F(a){return Object(a)!==a?a:a.valueOf()}function G(a){return a&&typeof a.promiseSend=="function"}function H(a){return I(a)||J(a)}function I(a){return!G(F(a))}function J(a){return a=F(a),G(a)&&"exception"in a}function M(a){a=a||new Error;var b=E({when:function(b){if(b){var c=m(K,this);c!==-1&&(L.splice(c,1),K.splice(c,1))}return b?b(a):M(a)}},function(){return M(a)},function(){return this},a);return K.push(b),L.push(a),b}function N(a){if(G(a))return a;if(a&&typeof a.then=="function"){var b=C();return a.then(b.resolve,b.reject),b.promise}return E({when:function(){return a},get:function(b){return a[b]},put:function(b,c){return a[b]=c},del:function(b){return delete a[b]},post:function(b,c){return a[b].apply(a,c)},apply:function(b,c){return a.apply(b,c)},fapply:function(b){return a.apply(void 0,b)},viewInfo:function(){function d(a){c[a]||(c[a]=typeof b[a])}var b=a,c={};while(b)Object.getOwnPropertyNames(b).forEach(d),b=Object.getPrototypeOf(b);return{type:typeof a,properties:c}},keys:function(){return p(a)}},void 0,function(){return a})}function O(a){return E({isDef:function(){}},function b(){var b=k(arguments);return X.apply(void 0,[a].concat(b))},function(){return F(a)})}function P(a,b){return a=N(a),b?E({viewInfo:function(){return b}},function(){var b=k(arguments);return X.apply(void 0,[a].concat(b))},function(){return F(a)}):X(a,"viewInfo")}function Q(a){return P(a).when(function(b){var c;b.type==="function"?c=function(){return _(a,void 0,arguments)}:c={};var d=b.properties||{};return p(d).forEach(function(b){d[b]==="function"&&(c[b]=function(){return $(a,b,arguments)})}),N(c)})}function R(a,b,c){function g(a){try{return b?b(a):a}catch(c){return M(c)}}function h(a){try{return c?c(a):M(a)}catch(b){return M(b)}}var d=C(),f=!1;return e(function(){N(a).promiseSend("when",function(a){if(f)return;f=!0,d.resolve(g(a))},function(a){if(f)return;f=!0,d.resolve(h(a))})}),d.promise}function S(a,b,c){return R(a,function(a){return bf(a).then(function(a){return b.apply(void 0,a)})},c)}function T(a){return function(){function b(a,b){var f;try{f=c[a](b)}catch(g){return r(g)?g.value:M(g)}return R(f,d,e)}var c=a.apply(this,arguments),d=b.bind(b,"send"),e=b.bind(b,"throw");return d()}}function U(a){throw new s(a)}function V(a){return function(){return bf([this,bf(arguments)]).spread(function(b,c){return a.apply(b,c)})}}function W(a){return function(b){var c=k(arguments,1);return X.apply(void 0,[b,a].concat(c))}}function X(a,b){var c=C(),d=k(arguments,2);return a=N(a),e(function(){a.promiseSend.apply(a,[b,c.resolve].concat(d))}),c.promise}function Y(a,b,c){var d=C();return a=N(a),e(function(){a.promiseSend.apply(a,[b,d.resolve].concat(c))}),d.promise}function Z(a){return function(b){var c=k(arguments,1);return Y(b,a,c)}}function bb(a,b){var c=k(arguments,2);return _(a,b,c)}function bc(a){var b=k(arguments,1);return ba(a,b)}function bd(a,b){var c=k(arguments,2);return function d(){var d=c.concat(k(arguments));return _(a,b,d)}}function be(a){var b=k(arguments,1);return function c(){var c=b.concat(k(arguments));return ba(a,c)}}function bf(a){return R(a,function(a){var b=a.length;if(b===0)return N(a);var c=C();return l(a,function(d,e,f){I(e)?(a[f]=F(e),--b===0&&c.resolve(a)):R(e,function(d){a[f]=d,--b===0&&c.resolve(a)}).fail(c.reject)},void 0),c.promise})}function bg(a){return R(a,function(a){return R(bf(n(a,function(a){return R(a,c,c)})),function(){return n(a,N)})})}function bh(a,b){return R(a,void 0,b)}function bi(a,b){return R(a,function(a){return R(b(),function(){return a})},function(a){return R(b(),function(){return M(a)})})}function bj(a){R(a,void 0,function(b){e(function(){var c;if(Error.captureStackTrace&&typeof b=="object"&&(c=w(b))){var d=w(a),e=c.concat("From previous event:",d);b.stack=t(b,e)}throw b})})}function bk(a,b){var c=C(),d=setTimeout(function(){c.reject(new Error("Timed out after "+b+" ms"))},b);return R(a,function(a){clearTimeout(d),c.resolve(a)},c.reject),c.promise}function bl(a,b){b===void 0&&(b=a,a=void 0);var c=C();return setTimeout(function(){c.resolve(a)},b),c.promise}function bm(a,b,c){return bo(a,b).apply(void 0,c)}function bn(a,b){var c=k(arguments,2);return bm(a,b,c)}function bo(a){if(arguments.length>1){var b=arguments[1],c=k(arguments,2),d=a;a=function(){var a=c.concat(k(arguments));return d.apply(b,a)}}return function(){var b=C(),c=k(arguments);return c.push(b.makeNodeResolver()),ba(a,c).fail(b.reject),b.promise}}function bp(a,b,c){return bm(a[b],a,c)}function bq(a,b){var c=k(arguments,2);return bm(a[b],a,c)}"use strict",A(new Error);var c=function(){},d=Object.freeze||c;typeof cajaVM!="undefined"&&(d=cajaVM.def);var e;if(typeof process!="undefined")e=process.nextTick;else if(typeof msSetImmediate=="function")e=msSetImmediate.bind(window);else if(typeof setImmediate=="function")e=setImmediate;else if(typeof MessageChannel!="undefined"){var f=new MessageChannel,g={},h=g;f.port1.onmessage=function(){g=g.next;var a=g.task;delete g.task,a()},e=function(a){h=h.next={task:a},f.port2.postMessage(0)}}else e=function(a){setTimeout(a,0)};var i;if(Function.prototype.bind){var j=Function.prototype.bind;i=j.bind(j.call)}else i=function(a){return function(){return a.call.apply(a,arguments)}};var k=i(Array.prototype.slice),l=i(Array.prototype.reduce||function(a,b){var c=0,d=this.length;if(arguments.length===1)do{if(c in this){b=this[c++];break}if(++c>=d)throw new TypeError}while(1);for(;c<d;c++)c in this&&(b=a(b,this[c],c));return b}),m=i(Array.prototype.indexOf||function(a){for(var b=0;b<this.length;b++)if(this[b]===a)return b;return-1}),n=i(Array.prototype.map||function(a,b){var c=this,d=[];return l(c,function(e,f,g){d.push(a.call(b,f,g,c))},void 0),d}),o=Object.create||function(a){function b(){}return b.prototype=a,new b},p=Object.keys||function(a){var b=[];for(var c in a)b.push(c);return b},q=Object.prototype.toString,s;typeof ReturnValue!="undefined"?s=ReturnValue:s=function(a){this.value=a};var x,y,z;b.nextTick=e,b.defer=C,C.prototype.makeNodeResolver=function(){var a=this;return function(b,c){b?a.reject(b):arguments.length>2?a.resolve(k(arguments,1)):a.resolve(c)}},C.prototype.node=B(C.prototype.makeNodeResolver,"node","makeNodeResolver"),b.promise=D,b.makePromise=E,E.prototype.then=function(a,b){return R(this,a,b)},l(["isResolved","isFulfilled","isRejected","when","spread","send","get","put","del","post","invoke","keys","apply","call","bind","fapply","fcall","fbind","all","allResolved","view","viewInfo","timeout","delay","catch","finally","fail","fin","end"],function(a,c){E.prototype[c]=function(){return b[c].apply(b,[this].concat(k(arguments)))}},void 0),E.prototype.toSource=function(){return this.toString()},E.prototype.toString=function(){return"[object Promise]"},d(E.prototype),b.nearer=F,b.isPromise=G,b.isResolved=H,b.isFulfilled=I,b.isRejected=J;var K=[],L=[];b.reject=M,b.begin=N,b.resolve=N,b.ref=B(N,"ref","resolve"),b.master=O,b.viewInfo=P,b.view=Q,b.when=R,b.spread=S,b.async=T,b["return"]=U,b.promised=V,b.sender=B(W,"sender","dispatcher"),b.Method=B(W,"Method","dispatcher"),b.send=B(X,"send","dispatch"),b.dispatch=Y,b.dispatcher=Z,b.get=Z("get"),b.put=Z("put"),b["delete"]=b.del=Z("del");var $=b.post=Z("post");b.invoke=function(a,b){var c=k(arguments,2);return $(a,b,c)};var _=b.apply=B(Z("apply"),"apply","fapply"),ba=b.fapply=Z("fapply");b.call=B(bb,"call","fcall"),b["try"]=bc,b.fcall=bc,b.bind=B(bd,"bind","fbind"),b.fbind=be,b.keys=Z("keys"),b.all=bf,b.allResolved=bg,b["catch"]=b.fail=bh,b["finally"]=b.fin=bi,b.end=bj,b.timeout=bk,b.delay=bl,b.napply=bm,b.ncall=bn,b.nbind=bo,b.npost=bp,b.ninvoke=bq,d(b),A(new Error)}),window.Bedrock={},Bedrock.connect=function(){Bedrock.socket=new WebSocket("wss://connect.bedrock.io"),Bedrock.socket.binaryType="arraybuffer",Bedrock.socket.onopen=function(){Bedrock._ready&&Bedrock.ready()},Bedrock.socket.onclose=function(){delete Bedrock.socket,Bedrock._notReady&&Bedrock.notReady(),_.delay(function(){Bedrock.connect()},5e3)},Bedrock.socket.onmessage=function(a){var b=Bedrock.decodeMessage(a);b.isResponse?Bedrock.rpc.response(b):Bedrock.receive(b)}},Bedrock.disconnect=function(){Bedrock.socket.close()},Bedrock.ready=function(a){Bedrock.ready=a,Bedrock._ready=!0},Bedrock.notReady=function(a){Bedrock.notReady=a,Bedrock._notReady=!0},Bedrock.decodeMessage=function(a){var b=msgpack.decode(a.data),c={isResponse:b[0]===1,isNotification:b[0]===2};return c.isResponse?_.extend(c,{target:b[1],payload:b[2]}):_.extend(c,{channel:b[1],data:b[2]}),c},Bedrock.rpc={},Bedrock.rpc.request=function(a,b){b=b||[],Bedrock.rpc.targets=Bedrock.rpc.targets||{};var c=Q.defer(),d=_.uniqueId();Bedrock.rpc.targets[d]=c;var e=[0,d,a,b],f=msgpack.encode(e);return Bedrock.socket.send(f),c.promise},Bedrock.rpc.notify=function(a,b){b=b||[];var c=[2,a,b],d=msgpack.encode(c);Bedrock.socket.send(d)},Bedrock.rpc.response=function(a){a.payload.ok?Bedrock.rpc.targets[a.target].resolve(a.payload.body):Bedrock.rpc.targets[a.target].reject(a.payload.body),delete Bedrock.rpc.targets[a.target]},Bedrock.on=function(a,b){return Bedrock.rpc.request("messaging.subscribe",[a]).then(function(a){Bedrock.handlers=Bedrock.handlers||{},_.each(a,function(a){Bedrock.handlers[a]=Bedrock.handlers[a]||[],Bedrock.handlers[a].push(b)})})},Bedrock.receive=function(a){_.each(Bedrock.handlers[a.channel],function(b){b(a.data)})},Bedrock.send=function(a,b){Bedrock.rpc.notify("messaging.publish",[a,b])};