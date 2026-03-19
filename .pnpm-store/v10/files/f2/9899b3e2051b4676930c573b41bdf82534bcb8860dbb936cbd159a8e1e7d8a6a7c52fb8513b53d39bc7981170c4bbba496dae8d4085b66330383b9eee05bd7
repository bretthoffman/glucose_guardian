import { p as ui, a as fi, r as li } from "../share.js";
import { B as $i, b as Ti, c as Ci, d as Pi, e as Ri, C as Ai, f as Si, g as Fi, E as Ei, G as Oi, I as ki, L as Di, M as Mi, R as ji, h as Wi, T as Ii, Z as Bi, i as Ui, j as Vi, k as Hi, l as Ni, m as Li, n as xi, o as zi, q as Zi, s as Gi, t as Xi, u as Yi, v as qi, w as Ki, x as Ji, y as Qi } from "../share.js";
async function Mr(A = {}) {
  var k, N, _r, l = A, Ee = !!globalThis.window, Oe = typeof Bun < "u", jr = !!globalThis.WorkerGlobalScope;
  !((N = globalThis.process) === null || N === void 0 || (N = N.versions) === null || N === void 0) && N.node && ((_r = globalThis.process) === null || _r === void 0 ? void 0 : _r.type) != "renderer";
  var Wr = "./this.program", ke, gr = "";
  function De(r) {
    return l.locateFile ? l.locateFile(r, gr) : gr + r;
  }
  var Ir, yr;
  if (Ee || jr || Oe) {
    try {
      gr = new URL(".", ke).href;
    } catch {
    }
    jr && (yr = (r) => {
      var e = new XMLHttpRequest();
      return e.open("GET", r, !1), e.responseType = "arraybuffer", e.send(null), new Uint8Array(e.response);
    }), Ir = async (r) => {
      var e = await fetch(r, {
        credentials: "same-origin"
      });
      if (e.ok)
        return e.arrayBuffer();
      throw new Error(e.status + " : " + e.url);
    };
  }
  var Br = console.log.bind(console), L = console.error.bind(console), G, Ur = !1, Vr, Hr, B, D, tr, X, Y, $, Nr, Lr, xr = !1;
  function zr() {
    var r = dr.buffer;
    B = new Int8Array(r), tr = new Int16Array(r), l.HEAPU8 = D = new Uint8Array(r), X = new Uint16Array(r), Y = new Int32Array(r), $ = new Uint32Array(r), Nr = new Float32Array(r), Lr = new Float64Array(r);
  }
  function Me() {
    if (l.preRun)
      for (typeof l.preRun == "function" && (l.preRun = [l.preRun]); l.preRun.length; )
        ze(l.preRun.shift());
    Zr(Xr);
  }
  function je() {
    xr = !0, rr.xa();
  }
  function We() {
    if (l.postRun)
      for (typeof l.postRun == "function" && (l.postRun = [l.postRun]); l.postRun.length; )
        xe(l.postRun.shift());
    Zr(Gr);
  }
  function mr(r) {
    var e, t;
    (e = l.onAbort) === null || e === void 0 || e.call(l, r), r = "Aborted(" + r + ")", L(r), Ur = !0, r += ". Build with -sASSERTIONS for more info.";
    var n = new WebAssembly.RuntimeError(r);
    throw (t = Hr) === null || t === void 0 || t(n), n;
  }
  var x;
  function Ie() {
    return De("zxing_reader.wasm");
  }
  function Be(r) {
    if (r == x && G)
      return new Uint8Array(G);
    if (yr)
      return yr(r);
    throw "both async and sync fetching of the wasm failed";
  }
  async function Ue(r) {
    if (!G)
      try {
        var e = await Ir(r);
        return new Uint8Array(e);
      } catch {
      }
    return Be(r);
  }
  async function Ve(r, e) {
    try {
      var t = await Ue(r), n = await WebAssembly.instantiate(t, e);
      return n;
    } catch (i) {
      L(`failed to asynchronously prepare wasm: ${i}`), mr(i);
    }
  }
  async function He(r, e, t) {
    if (!r && WebAssembly.instantiateStreaming)
      try {
        var n = fetch(e, {
          credentials: "same-origin"
        }), i = await WebAssembly.instantiateStreaming(n, t);
        return i;
      } catch (a) {
        L(`wasm streaming compile failed: ${a}`), L("falling back to ArrayBuffer instantiation");
      }
    return Ve(e, t);
  }
  function Ne() {
    var r = {
      a: Cn
    };
    return r;
  }
  async function Le() {
    function r(a, s) {
      return rr = a.exports, Tn(rr), zr(), rr;
    }
    function e(a) {
      return r(a.instance);
    }
    var t = Ne();
    if (l.instantiateWasm)
      return new Promise((a, s) => {
        l.instantiateWasm(t, (o, u) => {
          a(r(o));
        });
      });
    x != null || (x = Ie());
    var n = await He(G, x, t), i = e(n);
    return i;
  }
  var Zr = (r) => {
    for (; r.length > 0; )
      r.shift()(l);
  }, Gr = [], xe = (r) => Gr.push(r), Xr = [], ze = (r) => Xr.push(r), p = (r) => _e(r), h = () => ge(), nr = [], ir = 0, Ze = (r) => {
    var e = new br(r);
    return e.get_caught() || (e.set_caught(!0), ir--), e.set_rethrown(!1), nr.push(e), me(r), pe(r);
  }, M = 0, Ge = () => {
    d(0, 0);
    var r = nr.pop();
    ye(r.excPtr), M = 0;
  };
  class br {
    constructor(e) {
      this.excPtr = e, this.ptr = e - 24;
    }
    set_type(e) {
      $[this.ptr + 4 >> 2] = e;
    }
    get_type() {
      return $[this.ptr + 4 >> 2];
    }
    set_destructor(e) {
      $[this.ptr + 8 >> 2] = e;
    }
    get_destructor() {
      return $[this.ptr + 8 >> 2];
    }
    set_caught(e) {
      e = e ? 1 : 0, B[this.ptr + 12] = e;
    }
    get_caught() {
      return B[this.ptr + 12] != 0;
    }
    set_rethrown(e) {
      e = e ? 1 : 0, B[this.ptr + 13] = e;
    }
    get_rethrown() {
      return B[this.ptr + 13] != 0;
    }
    init(e, t) {
      this.set_adjusted_ptr(0), this.set_type(e), this.set_destructor(t);
    }
    set_adjusted_ptr(e) {
      $[this.ptr + 16 >> 2] = e;
    }
    get_adjusted_ptr() {
      return $[this.ptr + 16 >> 2];
    }
  }
  var ar = (r) => he(r), wr = (r) => {
    var e = M;
    if (!e)
      return ar(0), 0;
    var t = new br(e);
    t.set_adjusted_ptr(e);
    var n = t.get_type();
    if (!n)
      return ar(0), e;
    for (var i of r) {
      if (i === 0 || i === n)
        break;
      var a = t.ptr + 16;
      if (be(i, n, a))
        return ar(i), e;
    }
    return ar(n), e;
  }, Xe = () => wr([]), Ye = (r) => wr([r]), qe = (r, e) => wr([r, e]), Ke = () => {
    var r = nr.pop();
    r || mr("no exception to throw");
    var e = r.excPtr;
    throw r.get_rethrown() || (nr.push(r), r.set_rethrown(!0), r.set_caught(!1), ir++), M = e, M;
  }, Je = (r, e, t) => {
    var n = new br(r);
    throw n.init(e, t), M = r, ir++, M;
  }, Qe = () => ir, rt = (r) => {
    throw M || (M = r), M;
  }, et = () => mr(""), sr = {}, $r = (r) => {
    for (; r.length; ) {
      var e = r.pop(), t = r.pop();
      t(e);
    }
  };
  function q(r) {
    return this.fromWireType($[r >> 2]);
  }
  var z = {}, U = {}, or = {}, tt = class extends Error {
    constructor(e) {
      super(e), this.name = "InternalError";
    }
  }, ur = (r) => {
    throw new tt(r);
  }, V = (r, e, t) => {
    r.forEach((o) => or[o] = e);
    function n(o) {
      var u = t(o);
      u.length !== r.length && ur("Mismatched type converter count");
      for (var f = 0; f < r.length; ++f)
        E(r[f], u[f]);
    }
    var i = new Array(e.length), a = [], s = 0;
    {
      const o = e;
      for (let u = 0; u < o.length; ++u) {
        const f = o[u];
        U.hasOwnProperty(f) ? i[u] = U[f] : (a.push(f), z.hasOwnProperty(f) || (z[f] = []), z[f].push(() => {
          i[u] = U[f], ++s, s === a.length && n(i);
        }));
      }
    }
    a.length === 0 && n(i);
  }, nt = (r) => {
    var e = sr[r];
    delete sr[r];
    var t = e.rawConstructor, n = e.rawDestructor, i = e.fields, a = i.map((s) => s.getterReturnType).concat(i.map((s) => s.setterArgumentType));
    V([r], a, (s) => {
      var o = {};
      {
        const u = i;
        for (let f = 0; f < u.length; ++f) {
          const c = u[f], v = s[f], y = c.getter, b = c.getterContext, C = s[f + i.length], T = c.setter, w = c.setterContext;
          o[c.fieldName] = {
            read: (m) => v.fromWireType(y(b, m)),
            write: (m, F) => {
              var R = [];
              T(w, m, C.toWireType(R, F)), $r(R);
            },
            optional: v.optional
          };
        }
      }
      return [{
        name: e.name,
        fromWireType: (u) => {
          var f = {};
          for (var c in o)
            f[c] = o[c].read(u);
          return n(u), f;
        },
        toWireType: (u, f) => {
          for (var c in o)
            if (!(c in f) && !o[c].optional)
              throw new TypeError(`Missing field: "${c}"`);
          var v = t();
          for (c in o)
            o[c].write(v, f[c]);
          return u !== null && u.push(n, v), v;
        },
        readValueFromPointer: q,
        destructorFunction: n
      }];
    });
  }, it = (r, e, t, n, i) => {
  }, P = (r) => {
    for (var e = ""; ; ) {
      var t = D[r++];
      if (!t) return e;
      e += String.fromCharCode(t);
    }
  }, K = class extends Error {
    constructor(e) {
      super(e), this.name = "BindingError";
    }
  }, g = (r) => {
    throw new K(r);
  };
  function at(r, e) {
    let t = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
    var n = e.name;
    if (r || g(`type "${n}" must have a positive integer typeid pointer`), U.hasOwnProperty(r)) {
      if (t.ignoreDuplicateRegistrations)
        return;
      g(`Cannot register type '${n}' twice`);
    }
    if (U[r] = e, delete or[r], z.hasOwnProperty(r)) {
      var i = z[r];
      delete z[r], i.forEach((a) => a());
    }
  }
  function E(r, e) {
    let t = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
    return at(r, e, t);
  }
  var st = (r, e, t, n) => {
    e = P(e), E(r, {
      name: e,
      fromWireType: function(i) {
        return !!i;
      },
      toWireType: function(i, a) {
        return a ? t : n;
      },
      readValueFromPointer: function(i) {
        return this.fromWireType(D[i]);
      },
      destructorFunction: null
    });
  }, ot = (r) => ({
    count: r.count,
    deleteScheduled: r.deleteScheduled,
    preservePointerOnDelete: r.preservePointerOnDelete,
    ptr: r.ptr,
    ptrType: r.ptrType,
    smartPtr: r.smartPtr,
    smartPtrType: r.smartPtrType
  }), Tr = (r) => {
    function e(t) {
      return t.$$.ptrType.registeredClass.name;
    }
    g(e(r) + " instance already deleted");
  }, Cr = !1, Yr = (r) => {
  }, ut = (r) => {
    r.smartPtr ? r.smartPtrType.rawDestructor(r.smartPtr) : r.ptrType.registeredClass.rawDestructor(r.ptr);
  }, qr = (r) => {
    r.count.value -= 1;
    var e = r.count.value === 0;
    e && ut(r);
  }, J = (r) => globalThis.FinalizationRegistry ? (Cr = new FinalizationRegistry((e) => {
    qr(e.$$);
  }), J = (e) => {
    var t = e.$$, n = !!t.smartPtr;
    if (n) {
      var i = {
        $$: t
      };
      Cr.register(e, i, e);
    }
    return e;
  }, Yr = (e) => Cr.unregister(e), J(r)) : (J = (e) => e, r), ft = () => {
    let r = fr.prototype;
    Object.assign(r, {
      isAliasOf(t) {
        if (!(this instanceof fr) || !(t instanceof fr))
          return !1;
        var n = this.$$.ptrType.registeredClass, i = this.$$.ptr;
        t.$$ = t.$$;
        for (var a = t.$$.ptrType.registeredClass, s = t.$$.ptr; n.baseClass; )
          i = n.upcast(i), n = n.baseClass;
        for (; a.baseClass; )
          s = a.upcast(s), a = a.baseClass;
        return n === a && i === s;
      },
      clone() {
        if (this.$$.ptr || Tr(this), this.$$.preservePointerOnDelete)
          return this.$$.count.value += 1, this;
        var t = J(Object.create(Object.getPrototypeOf(this), {
          $$: {
            value: ot(this.$$)
          }
        }));
        return t.$$.count.value += 1, t.$$.deleteScheduled = !1, t;
      },
      delete() {
        this.$$.ptr || Tr(this), this.$$.deleteScheduled && !this.$$.preservePointerOnDelete && g("Object already scheduled for deletion"), Yr(this), qr(this.$$), this.$$.preservePointerOnDelete || (this.$$.smartPtr = void 0, this.$$.ptr = void 0);
      },
      isDeleted() {
        return !this.$$.ptr;
      },
      deleteLater() {
        return this.$$.ptr || Tr(this), this.$$.deleteScheduled && !this.$$.preservePointerOnDelete && g("Object already scheduled for deletion"), this.$$.deleteScheduled = !0, this;
      }
    });
    const e = Symbol.dispose;
    e && (r[e] = r.delete);
  };
  function fr() {
  }
  var Pr = (r, e) => Object.defineProperty(e, "name", {
    value: r
  }), Kr = {}, Jr = (r, e, t) => {
    if (r[e].overloadTable === void 0) {
      var n = r[e];
      r[e] = function() {
        for (var i = arguments.length, a = new Array(i), s = 0; s < i; s++)
          a[s] = arguments[s];
        return r[e].overloadTable.hasOwnProperty(a.length) || g(`Function '${t}' called with an invalid number of arguments (${a.length}) - expects one of (${r[e].overloadTable})!`), r[e].overloadTable[a.length].apply(this, a);
      }, r[e].overloadTable = [], r[e].overloadTable[n.argCount] = n;
    }
  }, Qr = (r, e, t) => {
    l.hasOwnProperty(r) ? ((t === void 0 || l[r].overloadTable !== void 0 && l[r].overloadTable[t] !== void 0) && g(`Cannot register public name '${r}' twice`), Jr(l, r, r), l[r].overloadTable.hasOwnProperty(t) && g(`Cannot register multiple overloads of a function with the same number of arguments (${t})!`), l[r].overloadTable[t] = e) : (l[r] = e, l[r].argCount = t);
  }, lt = 48, ct = 57, vt = (r) => {
    r = r.replace(/[^a-zA-Z0-9_]/g, "$");
    var e = r.charCodeAt(0);
    return e >= lt && e <= ct ? `_${r}` : r;
  };
  function dt(r, e, t, n, i, a, s, o) {
    this.name = r, this.constructor = e, this.instancePrototype = t, this.rawDestructor = n, this.baseClass = i, this.getActualType = a, this.upcast = s, this.downcast = o, this.pureVirtualFunctions = [];
  }
  var Rr = (r, e, t) => {
    for (; e !== t; )
      e.upcast || g(`Expected null or instance of ${t.name}, got an instance of ${e.name}`), r = e.upcast(r), e = e.baseClass;
    return r;
  }, Ar = (r) => {
    if (r === null)
      return "null";
    var e = typeof r;
    return e === "object" || e === "array" || e === "function" ? r.toString() : "" + r;
  };
  function pt(r, e) {
    if (e === null)
      return this.isReference && g(`null is not a valid ${this.name}`), 0;
    e.$$ || g(`Cannot pass "${Ar(e)}" as a ${this.name}`), e.$$.ptr || g(`Cannot pass deleted object as a pointer of type ${this.name}`);
    var t = e.$$.ptrType.registeredClass, n = Rr(e.$$.ptr, t, this.registeredClass);
    return n;
  }
  function ht(r, e) {
    var t;
    if (e === null)
      return this.isReference && g(`null is not a valid ${this.name}`), this.isSmartPointer ? (t = this.rawConstructor(), r !== null && r.push(this.rawDestructor, t), t) : 0;
    (!e || !e.$$) && g(`Cannot pass "${Ar(e)}" as a ${this.name}`), e.$$.ptr || g(`Cannot pass deleted object as a pointer of type ${this.name}`), !this.isConst && e.$$.ptrType.isConst && g(`Cannot convert argument of type ${e.$$.smartPtrType ? e.$$.smartPtrType.name : e.$$.ptrType.name} to parameter type ${this.name}`);
    var n = e.$$.ptrType.registeredClass;
    if (t = Rr(e.$$.ptr, n, this.registeredClass), this.isSmartPointer)
      switch (e.$$.smartPtr === void 0 && g("Passing raw pointer to smart pointer is illegal"), this.sharingPolicy) {
        case 0:
          e.$$.smartPtrType === this ? t = e.$$.smartPtr : g(`Cannot convert argument of type ${e.$$.smartPtrType ? e.$$.smartPtrType.name : e.$$.ptrType.name} to parameter type ${this.name}`);
          break;
        case 1:
          t = e.$$.smartPtr;
          break;
        case 2:
          if (e.$$.smartPtrType === this)
            t = e.$$.smartPtr;
          else {
            var i = e.clone();
            t = this.rawShare(t, O.toHandle(() => i.delete())), r !== null && r.push(this.rawDestructor, t);
          }
          break;
        default:
          g("Unsupporting sharing policy");
      }
    return t;
  }
  function _t(r, e) {
    if (e === null)
      return this.isReference && g(`null is not a valid ${this.name}`), 0;
    e.$$ || g(`Cannot pass "${Ar(e)}" as a ${this.name}`), e.$$.ptr || g(`Cannot pass deleted object as a pointer of type ${this.name}`), e.$$.ptrType.isConst && g(`Cannot convert argument of type ${e.$$.ptrType.name} to parameter type ${this.name}`);
    var t = e.$$.ptrType.registeredClass, n = Rr(e.$$.ptr, t, this.registeredClass);
    return n;
  }
  var re = (r, e, t) => {
    if (e === t)
      return r;
    if (t.baseClass === void 0)
      return null;
    var n = re(r, e, t.baseClass);
    return n === null ? null : t.downcast(n);
  }, gt = {}, yt = (r, e) => {
    for (e === void 0 && g("ptr should not be undefined"); r.baseClass; )
      e = r.upcast(e), r = r.baseClass;
    return e;
  }, mt = (r, e) => (e = yt(r, e), gt[e]), lr = (r, e) => {
    (!e.ptrType || !e.ptr) && ur("makeClassHandle requires ptr and ptrType");
    var t = !!e.smartPtrType, n = !!e.smartPtr;
    return t !== n && ur("Both smartPtrType and smartPtr must be specified"), e.count = {
      value: 1
    }, J(Object.create(r, {
      $$: {
        value: e,
        writable: !0
      }
    }));
  };
  function bt(r) {
    var e = this.getPointee(r);
    if (!e)
      return this.destructor(r), null;
    var t = mt(this.registeredClass, e);
    if (t !== void 0) {
      if (t.$$.count.value === 0)
        return t.$$.ptr = e, t.$$.smartPtr = r, t.clone();
      var n = t.clone();
      return this.destructor(r), n;
    }
    function i() {
      return this.isSmartPointer ? lr(this.registeredClass.instancePrototype, {
        ptrType: this.pointeeType,
        ptr: e,
        smartPtrType: this,
        smartPtr: r
      }) : lr(this.registeredClass.instancePrototype, {
        ptrType: this,
        ptr: r
      });
    }
    var a = this.registeredClass.getActualType(e), s = Kr[a];
    if (!s)
      return i.call(this);
    var o;
    this.isConst ? o = s.constPointerType : o = s.pointerType;
    var u = re(e, this.registeredClass, o.registeredClass);
    return u === null ? i.call(this) : this.isSmartPointer ? lr(o.registeredClass.instancePrototype, {
      ptrType: o,
      ptr: u,
      smartPtrType: this,
      smartPtr: r
    }) : lr(o.registeredClass.instancePrototype, {
      ptrType: o,
      ptr: u
    });
  }
  var wt = () => {
    Object.assign(cr.prototype, {
      getPointee(r) {
        return this.rawGetPointee && (r = this.rawGetPointee(r)), r;
      },
      destructor(r) {
        var e;
        (e = this.rawDestructor) === null || e === void 0 || e.call(this, r);
      },
      readValueFromPointer: q,
      fromWireType: bt
    });
  };
  function cr(r, e, t, n, i, a, s, o, u, f, c) {
    this.name = r, this.registeredClass = e, this.isReference = t, this.isConst = n, this.isSmartPointer = i, this.pointeeType = a, this.sharingPolicy = s, this.rawGetPointee = o, this.rawConstructor = u, this.rawShare = f, this.rawDestructor = c, !i && e.baseClass === void 0 ? n ? (this.toWireType = pt, this.destructorFunction = null) : (this.toWireType = _t, this.destructorFunction = null) : this.toWireType = ht;
  }
  var ee = (r, e, t) => {
    l.hasOwnProperty(r) || ur("Replacing nonexistent public symbol"), l[r].overloadTable !== void 0 && t !== void 0 ? l[r].overloadTable[t] = e : (l[r] = e, l[r].argCount = t);
  }, W = {}, $t = (r, e, t) => {
    r = r.replace(/p/g, "i");
    var n = W[r];
    return n(e, ...t);
  }, te = [], _ = (r) => {
    var e = te[r];
    return e || (te[r] = e = Te.get(r)), e;
  }, Tt = function(r, e) {
    let t = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : [];
    if (r.includes("j"))
      return $t(r, e, t);
    var n = _(e), i = n(...t);
    function a(s) {
      return s;
    }
    return i;
  }, Ct = function(r, e) {
    let t = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !1;
    return function() {
      for (var n = arguments.length, i = new Array(n), a = 0; a < n; a++)
        i[a] = arguments[a];
      return Tt(r, e, i, t);
    };
  }, S = function(r, e) {
    r = P(r);
    function t() {
      if (r.includes("j"))
        return Ct(r, e);
      var i = _(e);
      return i;
    }
    var n = t();
    return typeof n != "function" && g(`unknown function pointer with signature ${r}: ${e}`), n;
  };
  class Pt extends Error {
  }
  var ne = (r) => {
    var e = de(r), t = P(e);
    return I(e), t;
  }, vr = (r, e) => {
    var t = [], n = {};
    function i(a) {
      if (!n[a] && !U[a]) {
        if (or[a]) {
          or[a].forEach(i);
          return;
        }
        t.push(a), n[a] = !0;
      }
    }
    throw e.forEach(i), new Pt(`${r}: ` + t.map(ne).join([", "]));
  }, Rt = (r, e, t, n, i, a, s, o, u, f, c, v, y) => {
    c = P(c), a = S(i, a), o && (o = S(s, o)), f && (f = S(u, f)), y = S(v, y);
    var b = vt(c);
    Qr(b, function() {
      vr(`Cannot construct ${c} due to unbound types`, [n]);
    }), V([r, e, t], n ? [n] : [], (C) => {
      C = C[0];
      var T, w;
      n ? (T = C.registeredClass, w = T.instancePrototype) : w = fr.prototype;
      var m = Pr(c, function() {
        if (Object.getPrototypeOf(this) !== F)
          throw new K(`Use 'new' to construct ${c}`);
        if (R.constructor_body === void 0)
          throw new K(`${c} has no accessible constructor`);
        for (var Re = arguments.length, pr = new Array(Re), hr = 0; hr < Re; hr++)
          pr[hr] = arguments[hr];
        var Ae = R.constructor_body[pr.length];
        if (Ae === void 0)
          throw new K(`Tried to invoke ctor of ${c} with invalid number of parameters (${pr.length}) - expected (${Object.keys(R.constructor_body).toString()}) parameters instead!`);
        return Ae.apply(this, pr);
      }), F = Object.create(w, {
        constructor: {
          value: m
        }
      });
      m.prototype = F;
      var R = new dt(c, m, F, y, T, a, o, f);
      if (R.baseClass) {
        var j, er;
        (er = (j = R.baseClass).__derivedClasses) !== null && er !== void 0 || (j.__derivedClasses = []), R.baseClass.__derivedClasses.push(R);
      }
      var oi = new cr(c, R, !0, !1, !1), Ce = new cr(c + "*", R, !1, !1, !1), Pe = new cr(c + " const*", R, !1, !0, !1);
      return Kr[r] = {
        pointerType: Ce,
        constPointerType: Pe
      }, ee(b, m), [oi, Ce, Pe];
    });
  }, Sr = (r, e) => {
    for (var t = [], n = 0; n < r; n++)
      t.push($[e + n * 4 >> 2]);
    return t;
  };
  function At(r) {
    for (var e = 1; e < r.length; ++e)
      if (r[e] !== null && r[e].destructorFunction === void 0)
        return !0;
    return !1;
  }
  function Fr(r, e, t, n, i, a) {
    var s = e.length;
    s < 2 && g("argTypes array size mismatch! Must at least get return value and 'this' types!");
    var o = e[1] !== null && t !== null, u = At(e), f = !e[0].isVoid, c = s - 2, v = new Array(c), y = [], b = [], C = function() {
      b.length = 0;
      var T;
      y.length = o ? 2 : 1, y[0] = i, o && (T = e[1].toWireType(b, this), y[1] = T);
      for (var w = 0; w < c; ++w)
        v[w] = e[w + 2].toWireType(b, w < 0 || arguments.length <= w ? void 0 : arguments[w]), y.push(v[w]);
      var m = n(...y);
      function F(R) {
        if (u)
          $r(b);
        else
          for (var j = o ? 1 : 2; j < e.length; j++) {
            var er = j === 1 ? T : v[j - 2];
            e[j].destructorFunction !== null && e[j].destructorFunction(er);
          }
        if (f)
          return e[0].fromWireType(R);
      }
      return F(m);
    };
    return Pr(r, C);
  }
  var St = (r, e, t, n, i, a) => {
    var s = Sr(e, t);
    i = S(n, i), V([], [r], (o) => {
      o = o[0];
      var u = `constructor ${o.name}`;
      if (o.registeredClass.constructor_body === void 0 && (o.registeredClass.constructor_body = []), o.registeredClass.constructor_body[e - 1] !== void 0)
        throw new K(`Cannot register multiple constructors with identical number of parameters (${e - 1}) for class '${o.name}'! Overload resolution is currently only performed using the parameter count, not actual type info!`);
      return o.registeredClass.constructor_body[e - 1] = () => {
        vr(`Cannot construct ${o.name} due to unbound types`, s);
      }, V([], s, (f) => (f.splice(1, 0, null), o.registeredClass.constructor_body[e - 1] = Fr(u, f, null, i, a), [])), [];
    });
  }, ie = (r) => {
    r = r.trim();
    const e = r.indexOf("(");
    return e === -1 ? r : r.slice(0, e);
  }, Ft = (r, e, t, n, i, a, s, o, u, f) => {
    var c = Sr(t, n);
    e = P(e), e = ie(e), a = S(i, a), V([], [r], (v) => {
      v = v[0];
      var y = `${v.name}.${e}`;
      e.startsWith("@@") && (e = Symbol[e.substring(2)]), o && v.registeredClass.pureVirtualFunctions.push(e);
      function b() {
        vr(`Cannot call ${y} due to unbound types`, c);
      }
      var C = v.registeredClass.instancePrototype, T = C[e];
      return T === void 0 || T.overloadTable === void 0 && T.className !== v.name && T.argCount === t - 2 ? (b.argCount = t - 2, b.className = v.name, C[e] = b) : (Jr(C, e, y), C[e].overloadTable[t - 2] = b), V([], c, (w) => {
        var m = Fr(y, w, v, a, s);
        return C[e].overloadTable === void 0 ? (m.argCount = t - 2, C[e] = m) : C[e].overloadTable[t - 2] = m, [];
      }), [];
    });
  }, ae = [], H = [0, 1, , 1, null, 1, !0, 1, !1, 1], Er = (r) => {
    r > 9 && --H[r + 1] === 0 && (H[r] = void 0, ae.push(r));
  }, O = {
    toValue: (r) => (r || g(`Cannot use deleted val. handle = ${r}`), H[r]),
    toHandle: (r) => {
      switch (r) {
        case void 0:
          return 2;
        case null:
          return 4;
        case !0:
          return 6;
        case !1:
          return 8;
        default: {
          const e = ae.pop() || H.length;
          return H[e] = r, H[e + 1] = 1, e;
        }
      }
    }
  }, se = {
    name: "emscripten::val",
    fromWireType: (r) => {
      var e = O.toValue(r);
      return Er(r), e;
    },
    toWireType: (r, e) => O.toHandle(e),
    readValueFromPointer: q,
    destructorFunction: null
  }, Et = (r) => E(r, se), Ot = (r, e) => {
    switch (e) {
      case 4:
        return function(t) {
          return this.fromWireType(Nr[t >> 2]);
        };
      case 8:
        return function(t) {
          return this.fromWireType(Lr[t >> 3]);
        };
      default:
        throw new TypeError(`invalid float width (${e}): ${r}`);
    }
  }, kt = (r, e, t) => {
    e = P(e), E(r, {
      name: e,
      fromWireType: (n) => n,
      toWireType: (n, i) => i,
      readValueFromPointer: Ot(e, t),
      destructorFunction: null
    });
  }, Dt = (r, e, t, n, i, a, s, o) => {
    var u = Sr(e, t);
    r = P(r), r = ie(r), i = S(n, i), Qr(r, function() {
      vr(`Cannot call ${r} due to unbound types`, u);
    }, e - 1), V([], u, (f) => {
      var c = [f[0], null].concat(f.slice(1));
      return ee(r, Fr(r, c, null, i, a), e - 1), [];
    });
  }, Mt = (r, e, t) => {
    switch (e) {
      case 1:
        return t ? (n) => B[n] : (n) => D[n];
      case 2:
        return t ? (n) => tr[n >> 1] : (n) => X[n >> 1];
      case 4:
        return t ? (n) => Y[n >> 2] : (n) => $[n >> 2];
      default:
        throw new TypeError(`invalid integer width (${e}): ${r}`);
    }
  }, jt = (r, e, t, n, i) => {
    e = P(e);
    const a = n === 0;
    let s = (u) => u;
    if (a) {
      var o = 32 - 8 * t;
      s = (u) => u << o >>> o, i = s(i);
    }
    E(r, {
      name: e,
      fromWireType: s,
      toWireType: (u, f) => f,
      readValueFromPointer: Mt(e, t, n !== 0),
      destructorFunction: null
    });
  }, Wt = (r, e, t) => {
    var n = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array], i = n[e];
    function a(s) {
      var o = $[s >> 2], u = $[s + 4 >> 2];
      return new i(B.buffer, u, o);
    }
    t = P(t), E(r, {
      name: t,
      fromWireType: a,
      readValueFromPointer: a
    }, {
      ignoreDuplicateRegistrations: !0
    });
  }, It = Object.assign({
    optional: !0
  }, se), Bt = (r, e) => {
    E(r, It);
  }, Ut = (r, e, t, n) => {
    if (!(n > 0)) return 0;
    for (var i = t, a = t + n - 1, s = 0; s < r.length; ++s) {
      var o = r.codePointAt(s);
      if (o <= 127) {
        if (t >= a) break;
        e[t++] = o;
      } else if (o <= 2047) {
        if (t + 1 >= a) break;
        e[t++] = 192 | o >> 6, e[t++] = 128 | o & 63;
      } else if (o <= 65535) {
        if (t + 2 >= a) break;
        e[t++] = 224 | o >> 12, e[t++] = 128 | o >> 6 & 63, e[t++] = 128 | o & 63;
      } else {
        if (t + 3 >= a) break;
        e[t++] = 240 | o >> 18, e[t++] = 128 | o >> 12 & 63, e[t++] = 128 | o >> 6 & 63, e[t++] = 128 | o & 63, s++;
      }
    }
    return e[t] = 0, t - i;
  }, Z = (r, e, t) => Ut(r, D, e, t), oe = (r) => {
    for (var e = 0, t = 0; t < r.length; ++t) {
      var n = r.charCodeAt(t);
      n <= 127 ? e++ : n <= 2047 ? e += 2 : n >= 55296 && n <= 57343 ? (e += 4, ++t) : e += 3;
    }
    return e;
  }, ue = globalThis.TextDecoder && new TextDecoder(), fe = (r, e, t, n) => {
    var i = e + t;
    if (n) return i;
    for (; r[e] && !(e >= i); ) ++e;
    return e;
  }, le = function(r) {
    let e = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0, t = arguments.length > 2 ? arguments[2] : void 0, n = arguments.length > 3 ? arguments[3] : void 0;
    var i = fe(r, e, t, n);
    if (i - e > 16 && r.buffer && ue)
      return ue.decode(r.subarray(e, i));
    for (var a = ""; e < i; ) {
      var s = r[e++];
      if (!(s & 128)) {
        a += String.fromCharCode(s);
        continue;
      }
      var o = r[e++] & 63;
      if ((s & 224) == 192) {
        a += String.fromCharCode((s & 31) << 6 | o);
        continue;
      }
      var u = r[e++] & 63;
      if ((s & 240) == 224 ? s = (s & 15) << 12 | o << 6 | u : s = (s & 7) << 18 | o << 12 | u << 6 | r[e++] & 63, s < 65536)
        a += String.fromCharCode(s);
      else {
        var f = s - 65536;
        a += String.fromCharCode(55296 | f >> 10, 56320 | f & 1023);
      }
    }
    return a;
  }, Vt = (r, e, t) => r ? le(D, r, e, t) : "", Ht = (r, e) => {
    e = P(e), E(r, {
      name: e,
      fromWireType(t) {
        var n = $[t >> 2], i = t + 4, a;
        return a = Vt(i, n, !0), I(t), a;
      },
      toWireType(t, n) {
        n instanceof ArrayBuffer && (n = new Uint8Array(n));
        var i, a = typeof n == "string";
        a || ArrayBuffer.isView(n) && n.BYTES_PER_ELEMENT == 1 || g("Cannot pass non-string to std::string"), a ? i = oe(n) : i = n.length;
        var s = Dr(4 + i + 1), o = s + 4;
        return $[s >> 2] = i, a ? Z(n, o, i + 1) : D.set(n, o), t !== null && t.push(I, s), s;
      },
      readValueFromPointer: q,
      destructorFunction(t) {
        I(t);
      }
    });
  }, ce = globalThis.TextDecoder ? new TextDecoder("utf-16le") : void 0, Nt = (r, e, t) => {
    var n = r >> 1, i = fe(X, n, e / 2, t);
    if (i - n > 16 && ce) return ce.decode(X.subarray(n, i));
    for (var a = "", s = n; s < i; ++s) {
      var o = X[s];
      a += String.fromCharCode(o);
    }
    return a;
  }, Lt = (r, e, t) => {
    if (t != null || (t = 2147483647), t < 2) return 0;
    t -= 2;
    for (var n = e, i = t < r.length * 2 ? t / 2 : r.length, a = 0; a < i; ++a) {
      var s = r.charCodeAt(a);
      tr[e >> 1] = s, e += 2;
    }
    return tr[e >> 1] = 0, e - n;
  }, xt = (r) => r.length * 2, zt = (r, e, t) => {
    for (var n = "", i = r >> 2, a = 0; !(a >= e / 4); a++) {
      var s = $[i + a];
      if (!s && !t) break;
      n += String.fromCodePoint(s);
    }
    return n;
  }, Zt = (r, e, t) => {
    if (t != null || (t = 2147483647), t < 4) return 0;
    for (var n = e, i = n + t - 4, a = 0; a < r.length; ++a) {
      var s = r.codePointAt(a);
      if (s > 65535 && a++, Y[e >> 2] = s, e += 4, e + 4 > i) break;
    }
    return Y[e >> 2] = 0, e - n;
  }, Gt = (r) => {
    for (var e = 0, t = 0; t < r.length; ++t) {
      var n = r.codePointAt(t);
      n > 65535 && t++, e += 4;
    }
    return e;
  }, Xt = (r, e, t) => {
    t = P(t);
    var n, i, a;
    e === 2 ? (n = Nt, i = Lt, a = xt) : (n = zt, i = Zt, a = Gt), E(r, {
      name: t,
      fromWireType: (s) => {
        var o = $[s >> 2], u = n(s + 4, o * e, !0);
        return I(s), u;
      },
      toWireType: (s, o) => {
        typeof o != "string" && g(`Cannot pass non-string to C++ string type ${t}`);
        var u = a(o), f = Dr(4 + u + e);
        return $[f >> 2] = u / e, i(o, f + 4, u + e), s !== null && s.push(I, f), f;
      },
      readValueFromPointer: q,
      destructorFunction(s) {
        I(s);
      }
    });
  }, Yt = (r, e, t, n, i, a) => {
    sr[r] = {
      name: P(e),
      rawConstructor: S(t, n),
      rawDestructor: S(i, a),
      fields: []
    };
  }, qt = (r, e, t, n, i, a, s, o, u, f) => {
    sr[r].fields.push({
      fieldName: P(e),
      getterReturnType: t,
      getter: S(n, i),
      getterContext: a,
      setterArgumentType: s,
      setter: S(o, u),
      setterContext: f
    });
  }, Kt = (r, e) => {
    e = P(e), E(r, {
      isVoid: !0,
      name: e,
      fromWireType: () => {
      },
      toWireType: (t, n) => {
      }
    });
  }, Or = [], Jt = (r) => {
    var e = Or.length;
    return Or.push(r), e;
  }, Qt = (r, e) => {
    var t = U[r];
    return t === void 0 && g(`${e} has unknown type ${ne(r)}`), t;
  }, rn = (r, e) => {
    for (var t = new Array(r), n = 0; n < r; ++n)
      t[n] = Qt($[e + n * 4 >> 2], `parameter ${n}`);
    return t;
  }, en = (r, e, t) => {
    var n = [], i = r(n, t);
    return n.length && ($[e >> 2] = O.toHandle(n)), i;
  }, tn = {}, ve = (r) => {
    var e = tn[r];
    return e === void 0 ? P(r) : e;
  }, nn = (r, e, t) => {
    var n = 8, [i, ...a] = rn(r, e), s = i.toWireType.bind(i), o = a.map((v) => v.readValueFromPointer.bind(v));
    r--;
    var u = new Array(r), f = (v, y, b, C) => {
      for (var T = 0, w = 0; w < r; ++w)
        u[w] = o[w](C + T), T += n;
      var m;
      switch (t) {
        case 0:
          m = O.toValue(v).apply(null, u);
          break;
        case 2:
          m = Reflect.construct(O.toValue(v), u);
          break;
        case 3:
          m = u[0];
          break;
        case 1:
          m = O.toValue(v)[ve(y)](...u);
          break;
      }
      return en(s, b, m);
    }, c = `methodCaller<(${a.map((v) => v.name)}) => ${i.name}>`;
    return Jt(Pr(c, f));
  }, an = (r) => r ? (r = ve(r), O.toHandle(globalThis[r])) : O.toHandle(globalThis), sn = (r) => {
    r > 9 && (H[r + 1] += 1);
  }, on = (r, e, t, n, i) => Or[r](e, t, n, i), un = (r) => {
    var e = O.toValue(r);
    $r(e), Er(r);
  }, fn = (r, e, t, n) => {
    var i = (/* @__PURE__ */ new Date()).getFullYear(), a = new Date(i, 0, 1), s = new Date(i, 6, 1), o = a.getTimezoneOffset(), u = s.getTimezoneOffset(), f = Math.max(o, u);
    $[r >> 2] = f * 60, Y[e >> 2] = +(o != u);
    var c = (b) => {
      var C = b >= 0 ? "-" : "+", T = Math.abs(b), w = String(Math.floor(T / 60)).padStart(2, "0"), m = String(T % 60).padStart(2, "0");
      return `UTC${C}${w}${m}`;
    }, v = c(o), y = c(u);
    u < o ? (Z(v, t, 17), Z(y, n, 17)) : (Z(v, n, 17), Z(y, t, 17));
  }, ln = () => 2147483648, cn = (r, e) => Math.ceil(r / e) * e, vn = (r) => {
    var e = dr.buffer.byteLength, t = (r - e + 65535) / 65536 | 0;
    try {
      return dr.grow(t), zr(), 1;
    } catch {
    }
  }, dn = (r) => {
    var e = D.length;
    r >>>= 0;
    var t = ln();
    if (r > t)
      return !1;
    for (var n = 1; n <= 4; n *= 2) {
      var i = e * (1 + 0.2 / n);
      i = Math.min(i, r + 100663296);
      var a = Math.min(t, cn(Math.max(r, i), 65536)), s = vn(a);
      if (s)
        return !0;
    }
    return !1;
  }, kr = {}, pn = () => Wr || "./this.program", Q = () => {
    if (!Q.strings) {
      var r = (typeof navigator == "object" && navigator.language || "C").replace("-", "_") + ".UTF-8", e = {
        USER: "web_user",
        LOGNAME: "web_user",
        PATH: "/",
        PWD: "/",
        HOME: "/home/web_user",
        LANG: r,
        _: pn()
      };
      for (var t in kr)
        kr[t] === void 0 ? delete e[t] : e[t] = kr[t];
      var n = [];
      for (var t in e)
        n.push(`${t}=${e[t]}`);
      Q.strings = n;
    }
    return Q.strings;
  }, hn = (r, e) => {
    var t = 0, n = 0;
    for (var i of Q()) {
      var a = e + t;
      $[r + n >> 2] = a, t += Z(i, a, 1 / 0) + 1, n += 4;
    }
    return 0;
  }, _n = (r, e) => {
    var t = Q();
    $[r >> 2] = t.length;
    var n = 0;
    for (var i of t)
      n += oe(i) + 1;
    return $[e >> 2] = n, 0;
  }, gn = (r) => 52;
  function yn(r, e, t, n, i) {
    return 70;
  }
  var mn = [null, [], []], bn = (r, e) => {
    var t = mn[r];
    e === 0 || e === 10 ? ((r === 1 ? Br : L)(le(t)), t.length = 0) : t.push(e);
  }, wn = (r, e, t, n) => {
    for (var i = 0, a = 0; a < t; a++) {
      var s = $[e >> 2], o = $[e + 4 >> 2];
      e += 8;
      for (var u = 0; u < o; u++)
        bn(r, D[s + u]);
      i += o;
    }
    return $[n >> 2] = i, 0;
  }, $n = (r) => r;
  if (ft(), wt(), l.noExitRuntime && l.noExitRuntime, l.print && (Br = l.print), l.printErr && (L = l.printErr), l.wasmBinary && (G = l.wasmBinary), l.arguments && l.arguments, l.thisProgram && (Wr = l.thisProgram), l.preInit)
    for (typeof l.preInit == "function" && (l.preInit = [l.preInit]); l.preInit.length > 0; )
      l.preInit.shift()();
  var de, I, Dr, pe, d, he, _e, ge, ye, me, be, we, $e, dr, Te;
  function Tn(r) {
    de = r.ya, I = l._free = r.za, Dr = l._malloc = r.Ba, pe = r.Ca, d = r.Da, he = r.Ea, _e = r.Fa, ge = r.Ga, ye = r.Ha, me = r.Ia, be = r.Ja, W.viijii = r.Ka, we = W.iiijj = r.La, W.jiji = r.Ma, $e = W.jiiii = r.Na, W.iiiiij = r.Oa, W.iiiiijj = r.Pa, W.iiiiiijj = r.Qa, dr = r.wa, Te = r.Aa;
  }
  var Cn = {
    s: Ze,
    x: Ge,
    a: Xe,
    j: Ye,
    m: qe,
    P: Ke,
    q: Je,
    U: Qe,
    d: rt,
    ba: et,
    ta: nt,
    aa: it,
    oa: st,
    ra: Rt,
    qa: St,
    F: Ft,
    ma: Et,
    W: kt,
    X: Dt,
    z: jt,
    t: Wt,
    sa: Bt,
    na: Ht,
    R: Xt,
    G: Yt,
    ua: qt,
    pa: Kt,
    M: nn,
    va: Er,
    C: an,
    S: sn,
    L: on,
    ha: un,
    ca: fn,
    fa: dn,
    da: hn,
    ea: _n,
    ga: gn,
    _: yn,
    V: wn,
    J: Xn,
    B: qn,
    Y: kn,
    T: ei,
    r: xn,
    b: An,
    D: Gn,
    ja: Jn,
    c: Fn,
    ia: Qn,
    h: On,
    i: Bn,
    p: Vn,
    O: Zn,
    w: Nn,
    E: Ln,
    K: zn,
    I: ti,
    $: ii,
    Z: ai,
    f: Dn,
    l: Pn,
    e: Sn,
    g: En,
    N: ri,
    k: Rn,
    ka: Yn,
    o: Hn,
    y: jn,
    u: Un,
    Q: In,
    v: Kn,
    n: Mn,
    H: ni,
    la: Wn,
    A: $n
  };
  function Pn(r, e) {
    var t = h();
    try {
      _(r)(e);
    } catch (n) {
      if (p(t), n !== n + 0) throw n;
      d(1, 0);
    }
  }
  function Rn(r, e, t, n, i) {
    var a = h();
    try {
      _(r)(e, t, n, i);
    } catch (s) {
      if (p(a), s !== s + 0) throw s;
      d(1, 0);
    }
  }
  function An(r, e) {
    var t = h();
    try {
      return _(r)(e);
    } catch (n) {
      if (p(t), n !== n + 0) throw n;
      d(1, 0);
    }
  }
  function Sn(r, e, t) {
    var n = h();
    try {
      _(r)(e, t);
    } catch (i) {
      if (p(n), i !== i + 0) throw i;
      d(1, 0);
    }
  }
  function Fn(r, e, t) {
    var n = h();
    try {
      return _(r)(e, t);
    } catch (i) {
      if (p(n), i !== i + 0) throw i;
      d(1, 0);
    }
  }
  function En(r, e, t, n) {
    var i = h();
    try {
      _(r)(e, t, n);
    } catch (a) {
      if (p(i), a !== a + 0) throw a;
      d(1, 0);
    }
  }
  function On(r, e, t, n) {
    var i = h();
    try {
      return _(r)(e, t, n);
    } catch (a) {
      if (p(i), a !== a + 0) throw a;
      d(1, 0);
    }
  }
  function kn(r, e, t, n, i, a) {
    var s = h();
    try {
      return _(r)(e, t, n, i, a);
    } catch (o) {
      if (p(s), o !== o + 0) throw o;
      d(1, 0);
    }
  }
  function Dn(r) {
    var e = h();
    try {
      _(r)();
    } catch (t) {
      if (p(e), t !== t + 0) throw t;
      d(1, 0);
    }
  }
  function Mn(r, e, t, n, i, a, s, o, u, f, c) {
    var v = h();
    try {
      _(r)(e, t, n, i, a, s, o, u, f, c);
    } catch (y) {
      if (p(v), y !== y + 0) throw y;
      d(1, 0);
    }
  }
  function jn(r, e, t, n, i, a, s) {
    var o = h();
    try {
      _(r)(e, t, n, i, a, s);
    } catch (u) {
      if (p(o), u !== u + 0) throw u;
      d(1, 0);
    }
  }
  function Wn(r, e, t, n, i, a, s, o, u, f, c, v, y, b, C, T, w) {
    var m = h();
    try {
      _(r)(e, t, n, i, a, s, o, u, f, c, v, y, b, C, T, w);
    } catch (F) {
      if (p(m), F !== F + 0) throw F;
      d(1, 0);
    }
  }
  function In(r, e, t, n, i, a, s, o, u) {
    var f = h();
    try {
      _(r)(e, t, n, i, a, s, o, u);
    } catch (c) {
      if (p(f), c !== c + 0) throw c;
      d(1, 0);
    }
  }
  function Bn(r, e, t, n, i) {
    var a = h();
    try {
      return _(r)(e, t, n, i);
    } catch (s) {
      if (p(a), s !== s + 0) throw s;
      d(1, 0);
    }
  }
  function Un(r, e, t, n, i, a, s, o) {
    var u = h();
    try {
      _(r)(e, t, n, i, a, s, o);
    } catch (f) {
      if (p(u), f !== f + 0) throw f;
      d(1, 0);
    }
  }
  function Vn(r, e, t, n, i, a) {
    var s = h();
    try {
      return _(r)(e, t, n, i, a);
    } catch (o) {
      if (p(s), o !== o + 0) throw o;
      d(1, 0);
    }
  }
  function Hn(r, e, t, n, i, a) {
    var s = h();
    try {
      _(r)(e, t, n, i, a);
    } catch (o) {
      if (p(s), o !== o + 0) throw o;
      d(1, 0);
    }
  }
  function Nn(r, e, t, n, i, a, s) {
    var o = h();
    try {
      return _(r)(e, t, n, i, a, s);
    } catch (u) {
      if (p(o), u !== u + 0) throw u;
      d(1, 0);
    }
  }
  function Ln(r, e, t, n, i, a, s, o) {
    var u = h();
    try {
      return _(r)(e, t, n, i, a, s, o);
    } catch (f) {
      if (p(u), f !== f + 0) throw f;
      d(1, 0);
    }
  }
  function xn(r) {
    var e = h();
    try {
      return _(r)();
    } catch (t) {
      if (p(e), t !== t + 0) throw t;
      d(1, 0);
    }
  }
  function zn(r, e, t, n, i, a, s, o, u) {
    var f = h();
    try {
      return _(r)(e, t, n, i, a, s, o, u);
    } catch (c) {
      if (p(f), c !== c + 0) throw c;
      d(1, 0);
    }
  }
  function Zn(r, e, t, n, i, a, s) {
    var o = h();
    try {
      return _(r)(e, t, n, i, a, s);
    } catch (u) {
      if (p(o), u !== u + 0) throw u;
      d(1, 0);
    }
  }
  function Gn(r, e, t, n) {
    var i = h();
    try {
      return _(r)(e, t, n);
    } catch (a) {
      if (p(i), a !== a + 0) throw a;
      d(1, 0);
    }
  }
  function Xn(r, e, t, n) {
    var i = h();
    try {
      return _(r)(e, t, n);
    } catch (a) {
      if (p(i), a !== a + 0) throw a;
      d(1, 0);
    }
  }
  function Yn(r, e, t, n, i, a, s, o) {
    var u = h();
    try {
      _(r)(e, t, n, i, a, s, o);
    } catch (f) {
      if (p(u), f !== f + 0) throw f;
      d(1, 0);
    }
  }
  function qn(r, e, t, n, i, a) {
    var s = h();
    try {
      return _(r)(e, t, n, i, a);
    } catch (o) {
      if (p(s), o !== o + 0) throw o;
      d(1, 0);
    }
  }
  function Kn(r, e, t, n, i, a, s, o, u, f) {
    var c = h();
    try {
      _(r)(e, t, n, i, a, s, o, u, f);
    } catch (v) {
      if (p(c), v !== v + 0) throw v;
      d(1, 0);
    }
  }
  function Jn(r, e, t) {
    var n = h();
    try {
      return _(r)(e, t);
    } catch (i) {
      if (p(n), i !== i + 0) throw i;
      d(1, 0);
    }
  }
  function Qn(r, e, t, n, i) {
    var a = h();
    try {
      return _(r)(e, t, n, i);
    } catch (s) {
      if (p(a), s !== s + 0) throw s;
      d(1, 0);
    }
  }
  function ri(r, e, t, n, i, a, s) {
    var o = h();
    try {
      _(r)(e, t, n, i, a, s);
    } catch (u) {
      if (p(o), u !== u + 0) throw u;
      d(1, 0);
    }
  }
  function ei(r, e, t, n) {
    var i = h();
    try {
      return _(r)(e, t, n);
    } catch (a) {
      if (p(i), a !== a + 0) throw a;
      d(1, 0);
    }
  }
  function ti(r, e, t, n, i, a, s, o, u, f, c, v) {
    var y = h();
    try {
      return _(r)(e, t, n, i, a, s, o, u, f, c, v);
    } catch (b) {
      if (p(y), b !== b + 0) throw b;
      d(1, 0);
    }
  }
  function ni(r, e, t, n, i, a, s, o, u, f, c, v, y, b, C, T) {
    var w = h();
    try {
      _(r)(e, t, n, i, a, s, o, u, f, c, v, y, b, C, T);
    } catch (m) {
      if (p(w), m !== m + 0) throw m;
      d(1, 0);
    }
  }
  function ii(r, e, t, n, i, a, s) {
    var o = h();
    try {
      return we(r, e, t, n, i, a, s);
    } catch (u) {
      if (p(o), u !== u + 0) throw u;
      d(1, 0);
    }
  }
  function ai(r, e, t, n, i) {
    var a = h();
    try {
      return $e(r, e, t, n, i);
    } catch (s) {
      if (p(a), s !== s + 0) throw s;
      d(1, 0);
    }
  }
  function si() {
    Me();
    function r() {
      var e, t;
      l.calledRun = !0, !Ur && (je(), (e = Vr) === null || e === void 0 || e(l), (t = l.onRuntimeInitialized) === null || t === void 0 || t.call(l), We());
    }
    l.setStatus ? (l.setStatus("Running..."), setTimeout(() => {
      setTimeout(() => l.setStatus(""), 1), r();
    }, 1)) : r();
  }
  var rr;
  return rr = await Le(), si(), xr ? k = l : k = new Promise((r, e) => {
    Vr = r, Hr = e;
  }), k;
}
function Se(A) {
  return ui(Mr, A);
}
function pi() {
  return fi(Mr);
}
function hi(A) {
  return Se({
    overrides: A,
    equalityFn: Object.is,
    fireImmediately: !0
  });
}
function _i(A) {
  Se({
    overrides: A,
    equalityFn: Object.is,
    fireImmediately: !1
  });
}
async function Fe(A, k) {
  return li(Mr, A, k);
}
async function gi(A, k) {
  return Fe(A, k);
}
async function yi(A, k) {
  return Fe(A, k);
}
const mi = "8f2a99b0c9fdf8123d0152ba4761fc7dbf58c7de7e4937d1e134aae17e2ad795";
export {
  $i as BARCODE_FORMATS,
  Ti as BARCODE_HRI_LABELS,
  Ci as BARCODE_META_FORMATS,
  Pi as BARCODE_SYMBOLOGIES,
  Ri as BINARIZERS,
  Ai as CHARACTER_SETS,
  Si as CONTENT_TYPES,
  Fi as CREATABLE_BARCODE_FORMATS,
  Ei as EAN_ADD_ON_SYMBOLS,
  Oi as GS1_BARCODE_FORMATS,
  ki as INDUSTRIAL_BARCODE_FORMATS,
  Di as LINEAR_BARCODE_FORMATS,
  Mi as MATRIX_BARCODE_FORMATS,
  ji as READABLE_BARCODE_FORMATS,
  Wi as RETAIL_BARCODE_FORMATS,
  Ii as TEXT_MODES,
  Bi as ZXING_CPP_COMMIT,
  mi as ZXING_WASM_SHA256,
  Ui as ZXING_WASM_VERSION,
  Vi as barcodeFormats,
  Hi as binarizers,
  Ni as characterSets,
  Li as contentTypes,
  xi as defaultReaderOptions,
  zi as eanAddOnSymbols,
  Zi as encodeFormat,
  Gi as encodeFormats,
  Xi as formatToLabel,
  Yi as formatToSymbology,
  hi as getZXingModule,
  qi as linearBarcodeFormats,
  Ki as matrixBarcodeFormats,
  Se as prepareZXingModule,
  pi as purgeZXingModule,
  Fe as readBarcodes,
  yi as readBarcodesFromImageData,
  gi as readBarcodesFromImageFile,
  _i as setZXingModuleOverrides,
  Ji as symbologyToFormats,
  Qi as textModes
};
