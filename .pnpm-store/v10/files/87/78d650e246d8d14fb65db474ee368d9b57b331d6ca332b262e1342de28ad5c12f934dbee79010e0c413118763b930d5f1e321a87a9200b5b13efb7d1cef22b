var je = (a) => {
  throw TypeError(a);
};
var Le = (a, c, h) => c.has(a) || je("Cannot " + h);
var Ue = (a, c, h) => (Le(a, c, "read from private field"), h ? h.call(a) : c.get(a)), We = (a, c, h) => c.has(a) ? je("Cannot add the same private member more than once") : c instanceof WeakSet ? c.add(a) : c.set(a, h), ke = (a, c, h, v) => (Le(a, c, "write to private field"), v ? v.call(a, h) : c.set(a, h), h);
const L = [
  // name               sym  var  flags    zint  hri-label                  
  ["All", "*", "*", "     ", 0, "All"],
  ["AllReadable", "*", "r", "     ", 0, "All Readable"],
  ["AllCreatable", "*", "w", "     ", 0, "All Creatable"],
  ["AllLinear", "*", "l", "     ", 0, "All Linear"],
  ["AllMatrix", "*", "m", "     ", 0, "All Matrix"],
  ["AllGS1", "*", "G", "     ", 0, "All GS1"],
  ["AllRetail", "*", "R", "     ", 0, "All Retail"],
  ["AllIndustrial", "*", "I", "     ", 0, "All Industrial"],
  ["Codabar", "F", " ", "lrw  ", 18, "Codabar"],
  ["Code39", "A", " ", "lrw I", 8, "Code 39"],
  ["Code39Std", "A", "s", "lrw I", 8, "Code 39 Standard"],
  ["Code39Ext", "A", "e", "lr  I", 9, "Code 39 Extended"],
  ["Code32", "A", "2", "lr  I", 129, "Code 32"],
  ["PZN", "A", "p", "lr  I", 52, "Pharmazentralnummer"],
  ["Code93", "G", " ", "lrw I", 25, "Code 93"],
  ["Code128", "C", " ", "lrwGI", 20, "Code 128"],
  ["ITF", "I", " ", "lrw I", 3, "ITF"],
  ["ITF14", "I", "4", "lr  I", 89, "ITF-14"],
  ["DataBar", "e", " ", "lr GR", 29, "DataBar"],
  ["DataBarOmni", "e", "o", "lr GR", 29, "DataBar Omni"],
  ["DataBarStk", "e", "s", "lr GR", 79, "DataBar Stacked"],
  ["DataBarStkOmni", "e", "O", "lr GR", 80, "DataBar Stacked Omni"],
  ["DataBarLtd", "e", "l", "lr GR", 30, "DataBar Limited"],
  ["DataBarExp", "e", "e", "lr GR", 31, "DataBar Expanded"],
  ["DataBarExpStk", "e", "E", "lr GR", 81, "DataBar Expanded Stacked"],
  ["EANUPC", "E", " ", "lr  R", 15, "EAN/UPC"],
  ["EAN13", "E", "1", "lrw R", 15, "EAN-13"],
  ["EAN8", "E", "8", "lrw R", 10, "EAN-8"],
  ["EAN5", "E", "5", "l   R", 12, "EAN-5"],
  ["EAN2", "E", "2", "l   R", 11, "EAN-2"],
  ["ISBN", "E", "i", "lr  R", 69, "ISBN"],
  ["UPCA", "E", "a", "lrw R", 34, "UPC-A"],
  ["UPCE", "E", "e", "lrw R", 37, "UPC-E"],
  ["OtherBarcode", "X", " ", " r   ", 0, "Other barcode"],
  ["DXFilmEdge", "X", "x", "lr   ", 147, "DX Film Edge"],
  ["PDF417", "L", " ", "mrw  ", 55, "PDF417"],
  ["CompactPDF417", "L", "c", "mr   ", 56, "Compact PDF417"],
  ["MicroPDF417", "L", "m", "m    ", 84, "MicroPDF417"],
  ["Aztec", "z", " ", "mr G ", 92, "Aztec"],
  ["AztecCode", "z", "c", "mrwG ", 92, "Aztec Code"],
  ["AztecRune", "z", "r", "mr   ", 128, "Aztec Rune"],
  ["QRCode", "Q", " ", "mrwG ", 58, "QR Code"],
  ["QRCodeModel1", "Q", "1", "mr   ", 0, "QR Code Model 1"],
  ["QRCodeModel2", "Q", "2", "mr   ", 58, "QR Code Model 2"],
  ["MicroQRCode", "Q", "m", "mr   ", 97, "Micro QR Code"],
  ["RMQRCode", "Q", "r", "mr G ", 145, "rMQR Code"],
  ["DataMatrix", "d", " ", "mrwG ", 71, "Data Matrix"],
  ["MaxiCode", "U", " ", "mr   ", 57, "MaxiCode"]
], Da = {
  /**
   * @deprecated Use `DataBarExp` instead.
   */
  DataBarExpanded: "DataBarExp",
  /**
   * @deprecated Use `DataBarLtd` instead.
   */
  DataBarLimited: "DataBarLtd",
  /**
   * @deprecated Use `AllLinear` instead.
   */
  "Linear-Codes": "AllLinear",
  /**
   * @deprecated Use `AllMatrix` instead.
   */
  "Matrix-Codes": "AllMatrix",
  /**
   * @deprecated Use `All` instead.
   */
  Any: "All",
  rMQRCode: "RMQRCode"
};
L.map((a) => a[5]);
const Ia = L.filter((a) => a[1] === "*");
Ia.map(
  (a) => a[0]
);
const Sa = L.filter((a) => a[1] !== "*");
Sa.map((a) => a[0]);
const Ra = L.filter((a) => a[2] === " ");
Ra.map((a) => a[0]);
const Ma = L.filter(
  (a) => a[3][0] === "l"
);
Ma.map(
  (a) => a[0]
);
const Fa = L.filter(
  (a) => a[3][0] === "m"
);
Fa.map(
  (a) => a[0]
);
const Ba = L.filter(
  (a) => a[3][1] === "r"
);
Ba.map(
  (a) => a[0]
);
const ja = L.filter(
  (a) => a[3][2] === "w" || a[4] !== 0
);
ja.map(
  (a) => a[0]
);
const La = L.filter(
  (a) => a[3][3] === "G"
);
La.map((a) => a[0]);
const Ua = L.filter(
  (a) => a[3][4] === "R"
);
Ua.map(
  (a) => a[0]
);
const Wa = L.filter(
  (a) => a[3][4] === "I"
);
Wa.map(
  (a) => a[0]
);
function ka(a) {
  var c;
  return (c = Da[a]) != null ? c : a;
}
function Va(a) {
  return a.map(ka).join(",");
}
const Ga = [
  "LocalAverage",
  "GlobalHistogram",
  "FixedThreshold",
  "BoolCast"
];
function Ha(a) {
  return Ga.indexOf(a);
}
const Ve = [
  "Unknown",
  "ASCII",
  "ISO8859_1",
  "ISO8859_2",
  "ISO8859_3",
  "ISO8859_4",
  "ISO8859_5",
  "ISO8859_6",
  "ISO8859_7",
  "ISO8859_8",
  "ISO8859_9",
  "ISO8859_10",
  "ISO8859_11",
  "ISO8859_13",
  "ISO8859_14",
  "ISO8859_15",
  "ISO8859_16",
  "Cp437",
  "Cp1250",
  "Cp1251",
  "Cp1252",
  "Cp1256",
  "Shift_JIS",
  "Big5",
  "GB2312",
  "GB18030",
  "EUC_JP",
  "EUC_KR",
  "UTF16BE",
  "UTF8",
  "UTF16LE",
  "UTF32BE",
  "UTF32LE",
  "BINARY"
];
function za(a) {
  return a === "UnicodeBig" ? Ve.indexOf("UTF16BE") : Ve.indexOf(a);
}
const Na = [
  "Text",
  "Binary",
  "Mixed",
  "GS1",
  "ISO15434",
  "UnknownECI"
];
function Qa(a) {
  return Na[a];
}
const Xa = ["Ignore", "Read", "Require"];
function qa(a) {
  return Xa.indexOf(a);
}
const Ya = [
  "Plain",
  "ECI",
  "HRI",
  "Escaped",
  "Hex",
  "HexECI"
];
function Za(a) {
  return Ya.indexOf(a);
}
const It = {
  formats: [],
  tryHarder: !0,
  tryRotate: !0,
  tryInvert: !0,
  tryDownscale: !0,
  tryDenoise: !1,
  binarizer: "LocalAverage",
  isPure: !1,
  downscaleFactor: 3,
  downscaleThreshold: 500,
  minLineCount: 2,
  maxNumberOfSymbols: 255,
  validateOptionalChecksum: !1,
  returnErrors: !1,
  eanAddOnSymbol: "Ignore",
  textMode: "HRI",
  characterSet: "Unknown",
  tryCode39ExtendedMode: !0
};
function Ge(a) {
  var c;
  return {
    ...a,
    formats: Va(a.formats),
    binarizer: Ha(a.binarizer),
    eanAddOnSymbol: qa(a.eanAddOnSymbol),
    textMode: Za(a.textMode),
    characterSet: za(a.characterSet),
    tryCode39ExtendedMode: (c = a.tryCode39ExtendedMode) != null ? c : !0
  };
}
function Ja(a) {
  return {
    ...a,
    format: a.format,
    symbology: a.symbology,
    contentType: Qa(a.contentType)
  };
}
const To = "3.0.1", Eo = "eb8c15ef7827ee277bd8a9b093fa1d97bd98cf67", Ka = {
  locateFile: (a, c) => {
    const h = a.match(/_(.+?)\.wasm$/);
    return h ? `https://fastly.jsdelivr.net/npm/zxing-wasm@3.0.1/dist/${h[1]}/${a}` : c + a;
  }
}, Dt = /* @__PURE__ */ new WeakMap();
function to(a, c) {
  return Object.is(a, c) || Object.keys(a).length === Object.keys(c).length && Object.keys(a).every(
    (h) => Object.hasOwn(c, h) && a[h] === c[h]
  );
}
function ze(a, {
  overrides: c,
  equalityFn: h = to,
  fireImmediately: v = !1
} = {}) {
  var d;
  const [D, I] = (d = Dt.get(a)) != null ? d : [Ka], S = c != null ? c : D;
  let O;
  if (v) {
    if (I && (O = h(D, S)))
      return I;
    const R = a({
      ...S
    });
    return Dt.set(a, [S, R]), R;
  }
  (O != null ? O : h(D, S)) || Dt.set(a, [S]);
}
function eo(a) {
  Dt.delete(a);
}
function ro(a) {
  const c = a.byteLength >> 2, h = new Uint8Array(c);
  for (let v = 0; v < c; v++) {
    const d = v << 2;
    h[v] = 306 * a[d] + 601 * a[d + 1] + 117 * a[d + 2] + 512 >> 10;
  }
  return h;
}
async function no(a, c, h = It) {
  const v = {
    ...It,
    ...h
  }, d = await ze(a, {
    fireImmediately: !0
  });
  let D, I;
  if ("width" in c && "height" in c && "data" in c) {
    const { data: O, width: R, height: k } = c, Q = ro(O), V = Q.byteLength;
    if (I = d._malloc(V), !I)
      throw new Error(`Failed to allocate ${V} bytes in WASM memory`);
    try {
      d.HEAPU8.set(Q, I), D = d.readBarcodesFromPixmap(
        I,
        R,
        k,
        Ge(v)
      );
    } finally {
      d._free(I);
    }
  } else {
    let O, R;
    if ("buffer" in c)
      [O, R] = [c.byteLength, c];
    else if ("byteLength" in c)
      [O, R] = [c.byteLength, new Uint8Array(c)];
    else if ("size" in c)
      [O, R] = [c.size, new Uint8Array(await c.arrayBuffer())];
    else
      throw new TypeError("Invalid input type");
    if (I = d._malloc(O), !I)
      throw new Error(`Failed to allocate ${O} bytes in WASM memory`);
    try {
      d.HEAPU8.set(R, I), D = d.readBarcodesFromImage(
        I,
        O,
        Ge(v)
      );
    } finally {
      d._free(I);
    }
  }
  const S = [];
  for (let O = 0; O < D.size(); ++O)
    S.push(
      Ja(D.get(O))
    );
  return S;
}
({
  ...It,
  formats: [...It.formats]
});
async function Xt(a = {}) {
  var c, h, v, d = a, D = !!globalThis.window, I = typeof Bun < "u", S = !!globalThis.WorkerGlobalScope;
  !((h = globalThis.process) === null || h === void 0 || (h = h.versions) === null || h === void 0) && h.node && ((v = globalThis.process) === null || v === void 0 ? void 0 : v.type) != "renderer";
  var O = "./this.program", R, k = "";
  function Q(t) {
    return d.locateFile ? d.locateFile(t, k) : k + t;
  }
  var V, Y;
  if (D || S || I) {
    try {
      k = new URL(".", R).href;
    } catch {
    }
    S && (Y = (t) => {
      var e = new XMLHttpRequest();
      return e.open("GET", t, !1), e.responseType = "arraybuffer", e.send(null), new Uint8Array(e.response);
    }), V = async (t) => {
      var e = await fetch(t, {
        credentials: "same-origin"
      });
      if (e.ok)
        return e.arrayBuffer();
      throw new Error(e.status + " : " + e.url);
    };
  }
  var at = console.log.bind(console), G = console.error.bind(console), Z, ht = !1, qt, Yt, J, H, pt, ot, it, A, Zt, Jt, Kt = !1;
  function te() {
    var t = At.buffer;
    J = new Int8Array(t), pt = new Int16Array(t), d.HEAPU8 = H = new Uint8Array(t), ot = new Uint16Array(t), it = new Int32Array(t), A = new Uint32Array(t), Zt = new Float32Array(t), Jt = new Float64Array(t);
  }
  function rr() {
    if (d.preRun)
      for (typeof d.preRun == "function" && (d.preRun = [d.preRun]); d.preRun.length; )
        hr(d.preRun.shift());
    ee(ne);
  }
  function nr() {
    Kt = !0, dt.xa();
  }
  function ar() {
    if (d.postRun)
      for (typeof d.postRun == "function" && (d.postRun = [d.postRun]); d.postRun.length; )
        fr(d.postRun.shift());
    ee(re);
  }
  function St(t) {
    var e, r;
    (e = d.onAbort) === null || e === void 0 || e.call(d, t), t = "Aborted(" + t + ")", G(t), ht = !0, t += ". Build with -sASSERTIONS for more info.";
    var n = new WebAssembly.RuntimeError(t);
    throw (r = Yt) === null || r === void 0 || r(n), n;
  }
  var mt;
  function or() {
    return Q("zxing_reader.wasm");
  }
  function ir(t) {
    if (t == mt && Z)
      return new Uint8Array(Z);
    if (Y)
      return Y(t);
    throw "both async and sync fetching of the wasm failed";
  }
  async function sr(t) {
    if (!Z)
      try {
        var e = await V(t);
        return new Uint8Array(e);
      } catch {
      }
    return ir(t);
  }
  async function ur(t, e) {
    try {
      var r = await sr(t), n = await WebAssembly.instantiate(r, e);
      return n;
    } catch (o) {
      G(`failed to asynchronously prepare wasm: ${o}`), St(o);
    }
  }
  async function lr(t, e, r) {
    if (!t && WebAssembly.instantiateStreaming)
      try {
        var n = fetch(e, {
          credentials: "same-origin"
        }), o = await WebAssembly.instantiateStreaming(n, r);
        return o;
      } catch (i) {
        G(`wasm streaming compile failed: ${i}`), G("falling back to ArrayBuffer instantiation");
      }
    return ur(e, r);
  }
  function cr() {
    var t = {
      a: Nn
    };
    return t;
  }
  async function dr() {
    function t(i, s) {
      return dt = i.exports, zn(dt), te(), dt;
    }
    function e(i) {
      return t(i.instance);
    }
    var r = cr();
    if (d.instantiateWasm)
      return new Promise((i, s) => {
        d.instantiateWasm(r, (u, l) => {
          i(t(u));
        });
      });
    mt != null || (mt = or());
    var n = await lr(Z, mt, r), o = e(n);
    return o;
  }
  var ee = (t) => {
    for (; t.length > 0; )
      t.shift()(d);
  }, re = [], fr = (t) => re.push(t), ne = [], hr = (t) => ne.push(t), w = (t) => _e(t), g = () => Ae(), yt = [], vt = 0, pr = (t) => {
    var e = new Rt(t);
    return e.get_caught() || (e.set_caught(!0), vt--), e.set_rethrown(!1), yt.push(e), Oe(t), Te(t);
  }, z = 0, mr = () => {
    y(0, 0);
    var t = yt.pop();
    Pe(t.excPtr), z = 0;
  };
  class Rt {
    constructor(e) {
      this.excPtr = e, this.ptr = e - 24;
    }
    set_type(e) {
      A[this.ptr + 4 >> 2] = e;
    }
    get_type() {
      return A[this.ptr + 4 >> 2];
    }
    set_destructor(e) {
      A[this.ptr + 8 >> 2] = e;
    }
    get_destructor() {
      return A[this.ptr + 8 >> 2];
    }
    set_caught(e) {
      e = e ? 1 : 0, J[this.ptr + 12] = e;
    }
    get_caught() {
      return J[this.ptr + 12] != 0;
    }
    set_rethrown(e) {
      e = e ? 1 : 0, J[this.ptr + 13] = e;
    }
    get_rethrown() {
      return J[this.ptr + 13] != 0;
    }
    init(e, r) {
      this.set_adjusted_ptr(0), this.set_type(e), this.set_destructor(r);
    }
    set_adjusted_ptr(e) {
      A[this.ptr + 16 >> 2] = e;
    }
    get_adjusted_ptr() {
      return A[this.ptr + 16 >> 2];
    }
  }
  var wt = (t) => Ee(t), Mt = (t) => {
    var e = z;
    if (!e)
      return wt(0), 0;
    var r = new Rt(e);
    r.set_adjusted_ptr(e);
    var n = r.get_type();
    if (!n)
      return wt(0), e;
    for (var o of t) {
      if (o === 0 || o === n)
        break;
      var i = r.ptr + 16;
      if (xe(o, n, i))
        return wt(o), e;
    }
    return wt(n), e;
  }, yr = () => Mt([]), vr = (t) => Mt([t]), wr = (t, e) => Mt([t, e]), gr = () => {
    var t = yt.pop();
    t || St("no exception to throw");
    var e = t.excPtr;
    throw t.get_rethrown() || (yt.push(t), t.set_rethrown(!0), t.set_caught(!1), vt++), z = e, z;
  }, br = (t, e, r) => {
    var n = new Rt(t);
    throw n.init(e, r), z = t, vt++, z;
  }, Cr = () => vt, $r = (t) => {
    throw z || (z = t), z;
  }, Tr = () => St(""), gt = {}, Ft = (t) => {
    for (; t.length; ) {
      var e = t.pop(), r = t.pop();
      r(e);
    }
  };
  function st(t) {
    return this.fromWireType(A[t >> 2]);
  }
  var rt = {}, K = {}, bt = {}, Er = class extends Error {
    constructor(t) {
      super(t), this.name = "InternalError";
    }
  }, Ct = (t) => {
    throw new Er(t);
  }, tt = (t, e, r) => {
    t.forEach((u) => bt[u] = e);
    function n(u) {
      var l = r(u);
      l.length !== t.length && Ct("Mismatched type converter count");
      for (var f = 0; f < t.length; ++f)
        U(t[f], l[f]);
    }
    var o = new Array(e.length), i = [], s = 0;
    {
      const u = e;
      for (let l = 0; l < u.length; ++l) {
        const f = u[l];
        K.hasOwnProperty(f) ? o[l] = K[f] : (i.push(f), rt.hasOwnProperty(f) || (rt[f] = []), rt[f].push(() => {
          o[l] = K[f], ++s, s === i.length && n(o);
        }));
      }
    }
    i.length === 0 && n(o);
  }, _r = (t) => {
    var e = gt[t];
    delete gt[t];
    var r = e.rawConstructor, n = e.rawDestructor, o = e.fields, i = o.map((s) => s.getterReturnType).concat(o.map((s) => s.setterArgumentType));
    tt([t], i, (s) => {
      var u = {};
      {
        const l = o;
        for (let f = 0; f < l.length; ++f) {
          const p = l[f], m = s[f], $ = p.getter, E = p.getterContext, x = s[f + o.length], P = p.setter, _ = p.setterContext;
          u[p.fieldName] = {
            read: (T) => m.fromWireType($(E, T)),
            write: (T, j) => {
              var F = [];
              P(_, T, x.toWireType(F, j)), Ft(F);
            },
            optional: m.optional
          };
        }
      }
      return [{
        name: e.name,
        fromWireType: (l) => {
          var f = {};
          for (var p in u)
            f[p] = u[p].read(l);
          return n(l), f;
        },
        toWireType: (l, f) => {
          for (var p in u)
            if (!(p in f) && !u[p].optional)
              throw new TypeError(`Missing field: "${p}"`);
          var m = r();
          for (p in u)
            u[p].write(m, f[p]);
          return l !== null && l.push(n, m), m;
        },
        readValueFromPointer: st,
        destructorFunction: n
      }];
    });
  }, Ar = (t, e, r, n, o) => {
  }, M = (t) => {
    for (var e = ""; ; ) {
      var r = H[t++];
      if (!r) return e;
      e += String.fromCharCode(r);
    }
  }, ut = class extends Error {
    constructor(t) {
      super(t), this.name = "BindingError";
    }
  }, C = (t) => {
    throw new ut(t);
  };
  function Pr(t, e) {
    let r = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
    var n = e.name;
    if (t || C(`type "${n}" must have a positive integer typeid pointer`), K.hasOwnProperty(t)) {
      if (r.ignoreDuplicateRegistrations)
        return;
      C(`Cannot register type '${n}' twice`);
    }
    if (K[t] = e, delete bt[t], rt.hasOwnProperty(t)) {
      var o = rt[t];
      delete rt[t], o.forEach((i) => i());
    }
  }
  function U(t, e) {
    let r = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
    return Pr(t, e, r);
  }
  var Or = (t, e, r, n) => {
    e = M(e), U(t, {
      name: e,
      fromWireType: function(o) {
        return !!o;
      },
      toWireType: function(o, i) {
        return i ? r : n;
      },
      readValueFromPointer: function(o) {
        return this.fromWireType(H[o]);
      },
      destructorFunction: null
    });
  }, xr = (t) => ({
    count: t.count,
    deleteScheduled: t.deleteScheduled,
    preservePointerOnDelete: t.preservePointerOnDelete,
    ptr: t.ptr,
    ptrType: t.ptrType,
    smartPtr: t.smartPtr,
    smartPtrType: t.smartPtrType
  }), Bt = (t) => {
    function e(r) {
      return r.$$.ptrType.registeredClass.name;
    }
    C(e(t) + " instance already deleted");
  }, jt = !1, ae = (t) => {
  }, Dr = (t) => {
    t.smartPtr ? t.smartPtrType.rawDestructor(t.smartPtr) : t.ptrType.registeredClass.rawDestructor(t.ptr);
  }, oe = (t) => {
    t.count.value -= 1;
    var e = t.count.value === 0;
    e && Dr(t);
  }, lt = (t) => globalThis.FinalizationRegistry ? (jt = new FinalizationRegistry((e) => {
    oe(e.$$);
  }), lt = (e) => {
    var r = e.$$, n = !!r.smartPtr;
    if (n) {
      var o = {
        $$: r
      };
      jt.register(e, o, e);
    }
    return e;
  }, ae = (e) => jt.unregister(e), lt(t)) : (lt = (e) => e, t), Ir = () => {
    let t = $t.prototype;
    Object.assign(t, {
      isAliasOf(r) {
        if (!(this instanceof $t) || !(r instanceof $t))
          return !1;
        var n = this.$$.ptrType.registeredClass, o = this.$$.ptr;
        r.$$ = r.$$;
        for (var i = r.$$.ptrType.registeredClass, s = r.$$.ptr; n.baseClass; )
          o = n.upcast(o), n = n.baseClass;
        for (; i.baseClass; )
          s = i.upcast(s), i = i.baseClass;
        return n === i && o === s;
      },
      clone() {
        if (this.$$.ptr || Bt(this), this.$$.preservePointerOnDelete)
          return this.$$.count.value += 1, this;
        var r = lt(Object.create(Object.getPrototypeOf(this), {
          $$: {
            value: xr(this.$$)
          }
        }));
        return r.$$.count.value += 1, r.$$.deleteScheduled = !1, r;
      },
      delete() {
        this.$$.ptr || Bt(this), this.$$.deleteScheduled && !this.$$.preservePointerOnDelete && C("Object already scheduled for deletion"), ae(this), oe(this.$$), this.$$.preservePointerOnDelete || (this.$$.smartPtr = void 0, this.$$.ptr = void 0);
      },
      isDeleted() {
        return !this.$$.ptr;
      },
      deleteLater() {
        return this.$$.ptr || Bt(this), this.$$.deleteScheduled && !this.$$.preservePointerOnDelete && C("Object already scheduled for deletion"), this.$$.deleteScheduled = !0, this;
      }
    });
    const e = Symbol.dispose;
    e && (t[e] = t.delete);
  };
  function $t() {
  }
  var Lt = (t, e) => Object.defineProperty(e, "name", {
    value: t
  }), ie = {}, se = (t, e, r) => {
    if (t[e].overloadTable === void 0) {
      var n = t[e];
      t[e] = function() {
        for (var o = arguments.length, i = new Array(o), s = 0; s < o; s++)
          i[s] = arguments[s];
        return t[e].overloadTable.hasOwnProperty(i.length) || C(`Function '${r}' called with an invalid number of arguments (${i.length}) - expects one of (${t[e].overloadTable})!`), t[e].overloadTable[i.length].apply(this, i);
      }, t[e].overloadTable = [], t[e].overloadTable[n.argCount] = n;
    }
  }, ue = (t, e, r) => {
    d.hasOwnProperty(t) ? ((r === void 0 || d[t].overloadTable !== void 0 && d[t].overloadTable[r] !== void 0) && C(`Cannot register public name '${t}' twice`), se(d, t, t), d[t].overloadTable.hasOwnProperty(r) && C(`Cannot register multiple overloads of a function with the same number of arguments (${r})!`), d[t].overloadTable[r] = e) : (d[t] = e, d[t].argCount = r);
  }, Sr = 48, Rr = 57, Mr = (t) => {
    t = t.replace(/[^a-zA-Z0-9_]/g, "$");
    var e = t.charCodeAt(0);
    return e >= Sr && e <= Rr ? `_${t}` : t;
  };
  function Fr(t, e, r, n, o, i, s, u) {
    this.name = t, this.constructor = e, this.instancePrototype = r, this.rawDestructor = n, this.baseClass = o, this.getActualType = i, this.upcast = s, this.downcast = u, this.pureVirtualFunctions = [];
  }
  var Ut = (t, e, r) => {
    for (; e !== r; )
      e.upcast || C(`Expected null or instance of ${r.name}, got an instance of ${e.name}`), t = e.upcast(t), e = e.baseClass;
    return t;
  }, Wt = (t) => {
    if (t === null)
      return "null";
    var e = typeof t;
    return e === "object" || e === "array" || e === "function" ? t.toString() : "" + t;
  };
  function Br(t, e) {
    if (e === null)
      return this.isReference && C(`null is not a valid ${this.name}`), 0;
    e.$$ || C(`Cannot pass "${Wt(e)}" as a ${this.name}`), e.$$.ptr || C(`Cannot pass deleted object as a pointer of type ${this.name}`);
    var r = e.$$.ptrType.registeredClass, n = Ut(e.$$.ptr, r, this.registeredClass);
    return n;
  }
  function jr(t, e) {
    var r;
    if (e === null)
      return this.isReference && C(`null is not a valid ${this.name}`), this.isSmartPointer ? (r = this.rawConstructor(), t !== null && t.push(this.rawDestructor, r), r) : 0;
    (!e || !e.$$) && C(`Cannot pass "${Wt(e)}" as a ${this.name}`), e.$$.ptr || C(`Cannot pass deleted object as a pointer of type ${this.name}`), !this.isConst && e.$$.ptrType.isConst && C(`Cannot convert argument of type ${e.$$.smartPtrType ? e.$$.smartPtrType.name : e.$$.ptrType.name} to parameter type ${this.name}`);
    var n = e.$$.ptrType.registeredClass;
    if (r = Ut(e.$$.ptr, n, this.registeredClass), this.isSmartPointer)
      switch (e.$$.smartPtr === void 0 && C("Passing raw pointer to smart pointer is illegal"), this.sharingPolicy) {
        case 0:
          e.$$.smartPtrType === this ? r = e.$$.smartPtr : C(`Cannot convert argument of type ${e.$$.smartPtrType ? e.$$.smartPtrType.name : e.$$.ptrType.name} to parameter type ${this.name}`);
          break;
        case 1:
          r = e.$$.smartPtr;
          break;
        case 2:
          if (e.$$.smartPtrType === this)
            r = e.$$.smartPtr;
          else {
            var o = e.clone();
            r = this.rawShare(r, W.toHandle(() => o.delete())), t !== null && t.push(this.rawDestructor, r);
          }
          break;
        default:
          C("Unsupporting sharing policy");
      }
    return r;
  }
  function Lr(t, e) {
    if (e === null)
      return this.isReference && C(`null is not a valid ${this.name}`), 0;
    e.$$ || C(`Cannot pass "${Wt(e)}" as a ${this.name}`), e.$$.ptr || C(`Cannot pass deleted object as a pointer of type ${this.name}`), e.$$.ptrType.isConst && C(`Cannot convert argument of type ${e.$$.ptrType.name} to parameter type ${this.name}`);
    var r = e.$$.ptrType.registeredClass, n = Ut(e.$$.ptr, r, this.registeredClass);
    return n;
  }
  var le = (t, e, r) => {
    if (e === r)
      return t;
    if (r.baseClass === void 0)
      return null;
    var n = le(t, e, r.baseClass);
    return n === null ? null : r.downcast(n);
  }, Ur = {}, Wr = (t, e) => {
    for (e === void 0 && C("ptr should not be undefined"); t.baseClass; )
      e = t.upcast(e), t = t.baseClass;
    return e;
  }, kr = (t, e) => (e = Wr(t, e), Ur[e]), Tt = (t, e) => {
    (!e.ptrType || !e.ptr) && Ct("makeClassHandle requires ptr and ptrType");
    var r = !!e.smartPtrType, n = !!e.smartPtr;
    return r !== n && Ct("Both smartPtrType and smartPtr must be specified"), e.count = {
      value: 1
    }, lt(Object.create(t, {
      $$: {
        value: e,
        writable: !0
      }
    }));
  };
  function Vr(t) {
    var e = this.getPointee(t);
    if (!e)
      return this.destructor(t), null;
    var r = kr(this.registeredClass, e);
    if (r !== void 0) {
      if (r.$$.count.value === 0)
        return r.$$.ptr = e, r.$$.smartPtr = t, r.clone();
      var n = r.clone();
      return this.destructor(t), n;
    }
    function o() {
      return this.isSmartPointer ? Tt(this.registeredClass.instancePrototype, {
        ptrType: this.pointeeType,
        ptr: e,
        smartPtrType: this,
        smartPtr: t
      }) : Tt(this.registeredClass.instancePrototype, {
        ptrType: this,
        ptr: t
      });
    }
    var i = this.registeredClass.getActualType(e), s = ie[i];
    if (!s)
      return o.call(this);
    var u;
    this.isConst ? u = s.constPointerType : u = s.pointerType;
    var l = le(e, this.registeredClass, u.registeredClass);
    return l === null ? o.call(this) : this.isSmartPointer ? Tt(u.registeredClass.instancePrototype, {
      ptrType: u,
      ptr: l,
      smartPtrType: this,
      smartPtr: t
    }) : Tt(u.registeredClass.instancePrototype, {
      ptrType: u,
      ptr: l
    });
  }
  var Gr = () => {
    Object.assign(Et.prototype, {
      getPointee(t) {
        return this.rawGetPointee && (t = this.rawGetPointee(t)), t;
      },
      destructor(t) {
        var e;
        (e = this.rawDestructor) === null || e === void 0 || e.call(this, t);
      },
      readValueFromPointer: st,
      fromWireType: Vr
    });
  };
  function Et(t, e, r, n, o, i, s, u, l, f, p) {
    this.name = t, this.registeredClass = e, this.isReference = r, this.isConst = n, this.isSmartPointer = o, this.pointeeType = i, this.sharingPolicy = s, this.rawGetPointee = u, this.rawConstructor = l, this.rawShare = f, this.rawDestructor = p, !o && e.baseClass === void 0 ? n ? (this.toWireType = Br, this.destructorFunction = null) : (this.toWireType = Lr, this.destructorFunction = null) : this.toWireType = jr;
  }
  var ce = (t, e, r) => {
    d.hasOwnProperty(t) || Ct("Replacing nonexistent public symbol"), d[t].overloadTable !== void 0 && r !== void 0 ? d[t].overloadTable[r] = e : (d[t] = e, d[t].argCount = r);
  }, X = {}, Hr = (t, e, r) => {
    t = t.replace(/p/g, "i");
    var n = X[t];
    return n(e, ...r);
  }, de = [], b = (t) => {
    var e = de[t];
    return e || (de[t] = e = Se.get(t)), e;
  }, zr = function(t, e) {
    let r = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : [];
    if (t.includes("j"))
      return Hr(t, e, r);
    var n = b(e), o = n(...r);
    return o;
  }, Nr = function(t, e) {
    let r = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !1;
    return function() {
      for (var n = arguments.length, o = new Array(n), i = 0; i < n; i++)
        o[i] = arguments[i];
      return zr(t, e, o, r);
    };
  }, B = function(t, e) {
    t = M(t);
    function r() {
      if (t.includes("j"))
        return Nr(t, e);
      var o = b(e);
      return o;
    }
    var n = r();
    return typeof n != "function" && C(`unknown function pointer with signature ${t}: ${e}`), n;
  };
  class Qr extends Error {
  }
  var fe = (t) => {
    var e = $e(t), r = M(e);
    return q(e), r;
  }, _t = (t, e) => {
    var r = [], n = {};
    function o(i) {
      if (!n[i] && !K[i]) {
        if (bt[i]) {
          bt[i].forEach(o);
          return;
        }
        r.push(i), n[i] = !0;
      }
    }
    throw e.forEach(o), new Qr(`${t}: ` + r.map(fe).join([", "]));
  }, Xr = (t, e, r, n, o, i, s, u, l, f, p, m, $) => {
    p = M(p), i = B(o, i), u && (u = B(s, u)), f && (f = B(l, f)), $ = B(m, $);
    var E = Mr(p);
    ue(E, function() {
      _t(`Cannot construct ${p} due to unbound types`, [n]);
    }), tt([t, e, r], n ? [n] : [], (x) => {
      x = x[0];
      var P, _;
      n ? (P = x.registeredClass, _ = P.instancePrototype) : _ = $t.prototype;
      var T = Lt(p, function() {
        if (Object.getPrototypeOf(this) !== j)
          throw new ut(`Use 'new' to construct ${p}`);
        if (F.constructor_body === void 0)
          throw new ut(`${p} has no accessible constructor`);
        for (var Fe = arguments.length, Ot = new Array(Fe), xt = 0; xt < Fe; xt++)
          Ot[xt] = arguments[xt];
        var Be = F.constructor_body[Ot.length];
        if (Be === void 0)
          throw new ut(`Tried to invoke ctor of ${p} with invalid number of parameters (${Ot.length}) - expected (${Object.keys(F.constructor_body).toString()}) parameters instead!`);
        return Be.apply(this, Ot);
      }), j = Object.create(_, {
        constructor: {
          value: T
        }
      });
      T.prototype = j;
      var F = new Fr(p, T, j, $, P, i, u, f);
      if (F.baseClass) {
        var N, Pt;
        (Pt = (N = F.baseClass).__derivedClasses) !== null && Pt !== void 0 || (N.__derivedClasses = []), F.baseClass.__derivedClasses.push(F);
      }
      var xa = new Et(p, F, !0, !1, !1), Re = new Et(p + "*", F, !1, !1, !1), Me = new Et(p + " const*", F, !1, !0, !1);
      return ie[t] = {
        pointerType: Re,
        constPointerType: Me
      }, ce(E, T), [xa, Re, Me];
    });
  }, kt = (t, e) => {
    for (var r = [], n = 0; n < t; n++)
      r.push(A[e + n * 4 >> 2]);
    return r;
  };
  function qr(t) {
    for (var e = 1; e < t.length; ++e)
      if (t[e] !== null && t[e].destructorFunction === void 0)
        return !0;
    return !1;
  }
  function Vt(t, e, r, n, o, i) {
    var s = e.length;
    s < 2 && C("argTypes array size mismatch! Must at least get return value and 'this' types!");
    var u = e[1] !== null && r !== null, l = qr(e), f = !e[0].isVoid, p = s - 2, m = new Array(p), $ = [], E = [], x = function() {
      E.length = 0;
      var P;
      $.length = u ? 2 : 1, $[0] = o, u && (P = e[1].toWireType(E, this), $[1] = P);
      for (var _ = 0; _ < p; ++_)
        m[_] = e[_ + 2].toWireType(E, _ < 0 || arguments.length <= _ ? void 0 : arguments[_]), $.push(m[_]);
      var T = n(...$);
      function j(F) {
        if (l)
          Ft(E);
        else
          for (var N = u ? 1 : 2; N < e.length; N++) {
            var Pt = N === 1 ? P : m[N - 2];
            e[N].destructorFunction !== null && e[N].destructorFunction(Pt);
          }
        if (f)
          return e[0].fromWireType(F);
      }
      return j(T);
    };
    return Lt(t, x);
  }
  var Yr = (t, e, r, n, o, i) => {
    var s = kt(e, r);
    o = B(n, o), tt([], [t], (u) => {
      u = u[0];
      var l = `constructor ${u.name}`;
      if (u.registeredClass.constructor_body === void 0 && (u.registeredClass.constructor_body = []), u.registeredClass.constructor_body[e - 1] !== void 0)
        throw new ut(`Cannot register multiple constructors with identical number of parameters (${e - 1}) for class '${u.name}'! Overload resolution is currently only performed using the parameter count, not actual type info!`);
      return u.registeredClass.constructor_body[e - 1] = () => {
        _t(`Cannot construct ${u.name} due to unbound types`, s);
      }, tt([], s, (f) => (f.splice(1, 0, null), u.registeredClass.constructor_body[e - 1] = Vt(l, f, null, o, i), [])), [];
    });
  }, he = (t) => {
    t = t.trim();
    const e = t.indexOf("(");
    return e === -1 ? t : t.slice(0, e);
  }, Zr = (t, e, r, n, o, i, s, u, l, f) => {
    var p = kt(r, n);
    e = M(e), e = he(e), i = B(o, i), tt([], [t], (m) => {
      m = m[0];
      var $ = `${m.name}.${e}`;
      e.startsWith("@@") && (e = Symbol[e.substring(2)]), u && m.registeredClass.pureVirtualFunctions.push(e);
      function E() {
        _t(`Cannot call ${$} due to unbound types`, p);
      }
      var x = m.registeredClass.instancePrototype, P = x[e];
      return P === void 0 || P.overloadTable === void 0 && P.className !== m.name && P.argCount === r - 2 ? (E.argCount = r - 2, E.className = m.name, x[e] = E) : (se(x, e, $), x[e].overloadTable[r - 2] = E), tt([], p, (_) => {
        var T = Vt($, _, m, i, s);
        return x[e].overloadTable === void 0 ? (T.argCount = r - 2, x[e] = T) : x[e].overloadTable[r - 2] = T, [];
      }), [];
    });
  }, pe = [], et = [0, 1, , 1, null, 1, !0, 1, !1, 1], Gt = (t) => {
    t > 9 && --et[t + 1] === 0 && (et[t] = void 0, pe.push(t));
  }, W = {
    toValue: (t) => (t || C(`Cannot use deleted val. handle = ${t}`), et[t]),
    toHandle: (t) => {
      switch (t) {
        case void 0:
          return 2;
        case null:
          return 4;
        case !0:
          return 6;
        case !1:
          return 8;
        default: {
          const e = pe.pop() || et.length;
          return et[e] = t, et[e + 1] = 1, e;
        }
      }
    }
  }, me = {
    name: "emscripten::val",
    fromWireType: (t) => {
      var e = W.toValue(t);
      return Gt(t), e;
    },
    toWireType: (t, e) => W.toHandle(e),
    readValueFromPointer: st,
    destructorFunction: null
  }, Jr = (t) => U(t, me), Kr = (t, e) => {
    switch (e) {
      case 4:
        return function(r) {
          return this.fromWireType(Zt[r >> 2]);
        };
      case 8:
        return function(r) {
          return this.fromWireType(Jt[r >> 3]);
        };
      default:
        throw new TypeError(`invalid float width (${e}): ${t}`);
    }
  }, tn = (t, e, r) => {
    e = M(e), U(t, {
      name: e,
      fromWireType: (n) => n,
      toWireType: (n, o) => o,
      readValueFromPointer: Kr(e, r),
      destructorFunction: null
    });
  }, en = (t, e, r, n, o, i, s, u) => {
    var l = kt(e, r);
    t = M(t), t = he(t), o = B(n, o), ue(t, function() {
      _t(`Cannot call ${t} due to unbound types`, l);
    }, e - 1), tt([], l, (f) => {
      var p = [f[0], null].concat(f.slice(1));
      return ce(t, Vt(t, p, null, o, i), e - 1), [];
    });
  }, rn = (t, e, r) => {
    switch (e) {
      case 1:
        return r ? (n) => J[n] : (n) => H[n];
      case 2:
        return r ? (n) => pt[n >> 1] : (n) => ot[n >> 1];
      case 4:
        return r ? (n) => it[n >> 2] : (n) => A[n >> 2];
      default:
        throw new TypeError(`invalid integer width (${e}): ${t}`);
    }
  }, nn = (t, e, r, n, o) => {
    e = M(e);
    const i = n === 0;
    let s = (l) => l;
    if (i) {
      var u = 32 - 8 * r;
      s = (l) => l << u >>> u, o = s(o);
    }
    U(t, {
      name: e,
      fromWireType: s,
      toWireType: (l, f) => f,
      readValueFromPointer: rn(e, r, n !== 0),
      destructorFunction: null
    });
  }, an = (t, e, r) => {
    var n = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array], o = n[e];
    function i(s) {
      var u = A[s >> 2], l = A[s + 4 >> 2];
      return new o(J.buffer, l, u);
    }
    r = M(r), U(t, {
      name: r,
      fromWireType: i,
      readValueFromPointer: i
    }, {
      ignoreDuplicateRegistrations: !0
    });
  }, on = Object.assign({
    optional: !0
  }, me), sn = (t, e) => {
    U(t, on);
  }, un = (t, e, r, n) => {
    if (!(n > 0)) return 0;
    for (var o = r, i = r + n - 1, s = 0; s < t.length; ++s) {
      var u = t.codePointAt(s);
      if (u <= 127) {
        if (r >= i) break;
        e[r++] = u;
      } else if (u <= 2047) {
        if (r + 1 >= i) break;
        e[r++] = 192 | u >> 6, e[r++] = 128 | u & 63;
      } else if (u <= 65535) {
        if (r + 2 >= i) break;
        e[r++] = 224 | u >> 12, e[r++] = 128 | u >> 6 & 63, e[r++] = 128 | u & 63;
      } else {
        if (r + 3 >= i) break;
        e[r++] = 240 | u >> 18, e[r++] = 128 | u >> 12 & 63, e[r++] = 128 | u >> 6 & 63, e[r++] = 128 | u & 63, s++;
      }
    }
    return e[r] = 0, r - o;
  }, nt = (t, e, r) => un(t, H, e, r), ye = (t) => {
    for (var e = 0, r = 0; r < t.length; ++r) {
      var n = t.charCodeAt(r);
      n <= 127 ? e++ : n <= 2047 ? e += 2 : n >= 55296 && n <= 57343 ? (e += 4, ++r) : e += 3;
    }
    return e;
  }, ve = globalThis.TextDecoder && new TextDecoder(), we = (t, e, r, n) => {
    var o = e + r;
    if (n) return o;
    for (; t[e] && !(e >= o); ) ++e;
    return e;
  }, ge = function(t) {
    let e = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0, r = arguments.length > 2 ? arguments[2] : void 0, n = arguments.length > 3 ? arguments[3] : void 0;
    var o = we(t, e, r, n);
    if (o - e > 16 && t.buffer && ve)
      return ve.decode(t.subarray(e, o));
    for (var i = ""; e < o; ) {
      var s = t[e++];
      if (!(s & 128)) {
        i += String.fromCharCode(s);
        continue;
      }
      var u = t[e++] & 63;
      if ((s & 224) == 192) {
        i += String.fromCharCode((s & 31) << 6 | u);
        continue;
      }
      var l = t[e++] & 63;
      if ((s & 240) == 224 ? s = (s & 15) << 12 | u << 6 | l : s = (s & 7) << 18 | u << 12 | l << 6 | t[e++] & 63, s < 65536)
        i += String.fromCharCode(s);
      else {
        var f = s - 65536;
        i += String.fromCharCode(55296 | f >> 10, 56320 | f & 1023);
      }
    }
    return i;
  }, ln = (t, e, r) => t ? ge(H, t, e, r) : "", cn = (t, e) => {
    e = M(e), U(t, {
      name: e,
      fromWireType(r) {
        var n = A[r >> 2], o = r + 4, i;
        return i = ln(o, n, !0), q(r), i;
      },
      toWireType(r, n) {
        n instanceof ArrayBuffer && (n = new Uint8Array(n));
        var o, i = typeof n == "string";
        i || ArrayBuffer.isView(n) && n.BYTES_PER_ELEMENT == 1 || C("Cannot pass non-string to std::string"), i ? o = ye(n) : o = n.length;
        var s = Nt(4 + o + 1), u = s + 4;
        return A[s >> 2] = o, i ? nt(n, u, o + 1) : H.set(n, u), r !== null && r.push(q, s), s;
      },
      readValueFromPointer: st,
      destructorFunction(r) {
        q(r);
      }
    });
  }, be = globalThis.TextDecoder ? new TextDecoder("utf-16le") : void 0, dn = (t, e, r) => {
    var n = t >> 1, o = we(ot, n, e / 2, r);
    if (o - n > 16 && be) return be.decode(ot.subarray(n, o));
    for (var i = "", s = n; s < o; ++s) {
      var u = ot[s];
      i += String.fromCharCode(u);
    }
    return i;
  }, fn = (t, e, r) => {
    if (r != null || (r = 2147483647), r < 2) return 0;
    r -= 2;
    for (var n = e, o = r < t.length * 2 ? r / 2 : t.length, i = 0; i < o; ++i) {
      var s = t.charCodeAt(i);
      pt[e >> 1] = s, e += 2;
    }
    return pt[e >> 1] = 0, e - n;
  }, hn = (t) => t.length * 2, pn = (t, e, r) => {
    for (var n = "", o = t >> 2, i = 0; !(i >= e / 4); i++) {
      var s = A[o + i];
      if (!s && !r) break;
      n += String.fromCodePoint(s);
    }
    return n;
  }, mn = (t, e, r) => {
    if (r != null || (r = 2147483647), r < 4) return 0;
    for (var n = e, o = n + r - 4, i = 0; i < t.length; ++i) {
      var s = t.codePointAt(i);
      if (s > 65535 && i++, it[e >> 2] = s, e += 4, e + 4 > o) break;
    }
    return it[e >> 2] = 0, e - n;
  }, yn = (t) => {
    for (var e = 0, r = 0; r < t.length; ++r) {
      var n = t.codePointAt(r);
      n > 65535 && r++, e += 4;
    }
    return e;
  }, vn = (t, e, r) => {
    r = M(r);
    var n, o, i;
    e === 2 ? (n = dn, o = fn, i = hn) : (n = pn, o = mn, i = yn), U(t, {
      name: r,
      fromWireType: (s) => {
        var u = A[s >> 2], l = n(s + 4, u * e, !0);
        return q(s), l;
      },
      toWireType: (s, u) => {
        typeof u != "string" && C(`Cannot pass non-string to C++ string type ${r}`);
        var l = i(u), f = Nt(4 + l + e);
        return A[f >> 2] = l / e, o(u, f + 4, l + e), s !== null && s.push(q, f), f;
      },
      readValueFromPointer: st,
      destructorFunction(s) {
        q(s);
      }
    });
  }, wn = (t, e, r, n, o, i) => {
    gt[t] = {
      name: M(e),
      rawConstructor: B(r, n),
      rawDestructor: B(o, i),
      fields: []
    };
  }, gn = (t, e, r, n, o, i, s, u, l, f) => {
    gt[t].fields.push({
      fieldName: M(e),
      getterReturnType: r,
      getter: B(n, o),
      getterContext: i,
      setterArgumentType: s,
      setter: B(u, l),
      setterContext: f
    });
  }, bn = (t, e) => {
    e = M(e), U(t, {
      isVoid: !0,
      name: e,
      fromWireType: () => {
      },
      toWireType: (r, n) => {
      }
    });
  }, Ht = [], Cn = (t) => {
    var e = Ht.length;
    return Ht.push(t), e;
  }, $n = (t, e) => {
    var r = K[t];
    return r === void 0 && C(`${e} has unknown type ${fe(t)}`), r;
  }, Tn = (t, e) => {
    for (var r = new Array(t), n = 0; n < t; ++n)
      r[n] = $n(A[e + n * 4 >> 2], `parameter ${n}`);
    return r;
  }, En = (t, e, r) => {
    var n = [], o = t(n, r);
    return n.length && (A[e >> 2] = W.toHandle(n)), o;
  }, _n = {}, Ce = (t) => {
    var e = _n[t];
    return e === void 0 ? M(t) : e;
  }, An = (t, e, r) => {
    var n = 8, [o, ...i] = Tn(t, e), s = o.toWireType.bind(o), u = i.map((m) => m.readValueFromPointer.bind(m));
    t--;
    var l = new Array(t), f = (m, $, E, x) => {
      for (var P = 0, _ = 0; _ < t; ++_)
        l[_] = u[_](x + P), P += n;
      var T;
      switch (r) {
        case 0:
          T = W.toValue(m).apply(null, l);
          break;
        case 2:
          T = Reflect.construct(W.toValue(m), l);
          break;
        case 3:
          T = l[0];
          break;
        case 1:
          T = W.toValue(m)[Ce($)](...l);
          break;
      }
      return En(s, E, T);
    }, p = `methodCaller<(${i.map((m) => m.name)}) => ${o.name}>`;
    return Cn(Lt(p, f));
  }, Pn = (t) => t ? (t = Ce(t), W.toHandle(globalThis[t])) : W.toHandle(globalThis), On = (t) => {
    t > 9 && (et[t + 1] += 1);
  }, xn = (t, e, r, n, o) => Ht[t](e, r, n, o), Dn = (t) => {
    var e = W.toValue(t);
    Ft(e), Gt(t);
  }, In = (t, e, r, n) => {
    var o = (/* @__PURE__ */ new Date()).getFullYear(), i = new Date(o, 0, 1), s = new Date(o, 6, 1), u = i.getTimezoneOffset(), l = s.getTimezoneOffset(), f = Math.max(u, l);
    A[t >> 2] = f * 60, it[e >> 2] = +(u != l);
    var p = (E) => {
      var x = E >= 0 ? "-" : "+", P = Math.abs(E), _ = String(Math.floor(P / 60)).padStart(2, "0"), T = String(P % 60).padStart(2, "0");
      return `UTC${x}${_}${T}`;
    }, m = p(u), $ = p(l);
    l < u ? (nt(m, r, 17), nt($, n, 17)) : (nt(m, n, 17), nt($, r, 17));
  }, Sn = () => 2147483648, Rn = (t, e) => Math.ceil(t / e) * e, Mn = (t) => {
    var e = At.buffer.byteLength, r = (t - e + 65535) / 65536 | 0;
    try {
      return At.grow(r), te(), 1;
    } catch {
    }
  }, Fn = (t) => {
    var e = H.length;
    t >>>= 0;
    var r = Sn();
    if (t > r)
      return !1;
    for (var n = 1; n <= 4; n *= 2) {
      var o = e * (1 + 0.2 / n);
      o = Math.min(o, t + 100663296);
      var i = Math.min(r, Rn(Math.max(t, o), 65536)), s = Mn(i);
      if (s)
        return !0;
    }
    return !1;
  }, zt = {}, Bn = () => O || "./this.program", ct = () => {
    if (!ct.strings) {
      var t = (typeof navigator == "object" && navigator.language || "C").replace("-", "_") + ".UTF-8", e = {
        USER: "web_user",
        LOGNAME: "web_user",
        PATH: "/",
        PWD: "/",
        HOME: "/home/web_user",
        LANG: t,
        _: Bn()
      };
      for (var r in zt)
        zt[r] === void 0 ? delete e[r] : e[r] = zt[r];
      var n = [];
      for (var r in e)
        n.push(`${r}=${e[r]}`);
      ct.strings = n;
    }
    return ct.strings;
  }, jn = (t, e) => {
    var r = 0, n = 0;
    for (var o of ct()) {
      var i = e + r;
      A[t + n >> 2] = i, r += nt(o, i, 1 / 0) + 1, n += 4;
    }
    return 0;
  }, Ln = (t, e) => {
    var r = ct();
    A[t >> 2] = r.length;
    var n = 0;
    for (var o of r)
      n += ye(o) + 1;
    return A[e >> 2] = n, 0;
  }, Un = (t) => 52;
  function Wn(t, e, r, n, o) {
    return 70;
  }
  var kn = [null, [], []], Vn = (t, e) => {
    var r = kn[t];
    e === 0 || e === 10 ? ((t === 1 ? at : G)(ge(r)), r.length = 0) : r.push(e);
  }, Gn = (t, e, r, n) => {
    for (var o = 0, i = 0; i < r; i++) {
      var s = A[e >> 2], u = A[e + 4 >> 2];
      e += 8;
      for (var l = 0; l < u; l++)
        Vn(t, H[s + l]);
      o += u;
    }
    return A[n >> 2] = o, 0;
  }, Hn = (t) => t;
  if (Ir(), Gr(), d.noExitRuntime && d.noExitRuntime, d.print && (at = d.print), d.printErr && (G = d.printErr), d.wasmBinary && (Z = d.wasmBinary), d.arguments && d.arguments, d.thisProgram && (O = d.thisProgram), d.preInit)
    for (typeof d.preInit == "function" && (d.preInit = [d.preInit]); d.preInit.length > 0; )
      d.preInit.shift()();
  var $e, q, Nt, Te, y, Ee, _e, Ae, Pe, Oe, xe, De, Ie, At, Se;
  function zn(t) {
    $e = t.ya, q = d._free = t.za, Nt = d._malloc = t.Ba, Te = t.Ca, y = t.Da, Ee = t.Ea, _e = t.Fa, Ae = t.Ga, Pe = t.Ha, Oe = t.Ia, xe = t.Ja, X.viijii = t.Ka, De = X.iiijj = t.La, X.jiji = t.Ma, Ie = X.jiiii = t.Na, X.iiiiij = t.Oa, X.iiiiijj = t.Pa, X.iiiiiijj = t.Qa, At = t.wa, Se = t.Aa;
  }
  var Nn = {
    s: pr,
    x: mr,
    a: yr,
    j: vr,
    m: wr,
    P: gr,
    q: br,
    U: Cr,
    d: $r,
    ba: Tr,
    ta: _r,
    aa: Ar,
    oa: Or,
    ra: Xr,
    qa: Yr,
    F: Zr,
    ma: Jr,
    W: tn,
    X: en,
    z: nn,
    t: an,
    sa: sn,
    na: cn,
    R: vn,
    G: wn,
    ua: gn,
    pa: bn,
    M: An,
    va: Gt,
    C: Pn,
    S: On,
    L: xn,
    ha: Dn,
    ca: In,
    fa: Fn,
    da: jn,
    ea: Ln,
    ga: Un,
    _: Wn,
    V: Gn,
    J: ya,
    B: wa,
    Y: ta,
    T: Ta,
    r: fa,
    b: qn,
    D: ma,
    ja: ba,
    c: Zn,
    ia: Ca,
    h: Kn,
    i: ia,
    p: ua,
    O: pa,
    w: ca,
    E: da,
    K: ha,
    I: Ea,
    $: Aa,
    Z: Pa,
    f: ea,
    l: Qn,
    e: Yn,
    g: Jn,
    N: $a,
    k: Xn,
    ka: va,
    o: la,
    y: na,
    u: sa,
    Q: oa,
    v: ga,
    n: ra,
    H: _a,
    la: aa,
    A: Hn
  };
  function Qn(t, e) {
    var r = g();
    try {
      b(t)(e);
    } catch (n) {
      if (w(r), n !== n + 0) throw n;
      y(1, 0);
    }
  }
  function Xn(t, e, r, n, o) {
    var i = g();
    try {
      b(t)(e, r, n, o);
    } catch (s) {
      if (w(i), s !== s + 0) throw s;
      y(1, 0);
    }
  }
  function qn(t, e) {
    var r = g();
    try {
      return b(t)(e);
    } catch (n) {
      if (w(r), n !== n + 0) throw n;
      y(1, 0);
    }
  }
  function Yn(t, e, r) {
    var n = g();
    try {
      b(t)(e, r);
    } catch (o) {
      if (w(n), o !== o + 0) throw o;
      y(1, 0);
    }
  }
  function Zn(t, e, r) {
    var n = g();
    try {
      return b(t)(e, r);
    } catch (o) {
      if (w(n), o !== o + 0) throw o;
      y(1, 0);
    }
  }
  function Jn(t, e, r, n) {
    var o = g();
    try {
      b(t)(e, r, n);
    } catch (i) {
      if (w(o), i !== i + 0) throw i;
      y(1, 0);
    }
  }
  function Kn(t, e, r, n) {
    var o = g();
    try {
      return b(t)(e, r, n);
    } catch (i) {
      if (w(o), i !== i + 0) throw i;
      y(1, 0);
    }
  }
  function ta(t, e, r, n, o, i) {
    var s = g();
    try {
      return b(t)(e, r, n, o, i);
    } catch (u) {
      if (w(s), u !== u + 0) throw u;
      y(1, 0);
    }
  }
  function ea(t) {
    var e = g();
    try {
      b(t)();
    } catch (r) {
      if (w(e), r !== r + 0) throw r;
      y(1, 0);
    }
  }
  function ra(t, e, r, n, o, i, s, u, l, f, p) {
    var m = g();
    try {
      b(t)(e, r, n, o, i, s, u, l, f, p);
    } catch ($) {
      if (w(m), $ !== $ + 0) throw $;
      y(1, 0);
    }
  }
  function na(t, e, r, n, o, i, s) {
    var u = g();
    try {
      b(t)(e, r, n, o, i, s);
    } catch (l) {
      if (w(u), l !== l + 0) throw l;
      y(1, 0);
    }
  }
  function aa(t, e, r, n, o, i, s, u, l, f, p, m, $, E, x, P, _) {
    var T = g();
    try {
      b(t)(e, r, n, o, i, s, u, l, f, p, m, $, E, x, P, _);
    } catch (j) {
      if (w(T), j !== j + 0) throw j;
      y(1, 0);
    }
  }
  function oa(t, e, r, n, o, i, s, u, l) {
    var f = g();
    try {
      b(t)(e, r, n, o, i, s, u, l);
    } catch (p) {
      if (w(f), p !== p + 0) throw p;
      y(1, 0);
    }
  }
  function ia(t, e, r, n, o) {
    var i = g();
    try {
      return b(t)(e, r, n, o);
    } catch (s) {
      if (w(i), s !== s + 0) throw s;
      y(1, 0);
    }
  }
  function sa(t, e, r, n, o, i, s, u) {
    var l = g();
    try {
      b(t)(e, r, n, o, i, s, u);
    } catch (f) {
      if (w(l), f !== f + 0) throw f;
      y(1, 0);
    }
  }
  function ua(t, e, r, n, o, i) {
    var s = g();
    try {
      return b(t)(e, r, n, o, i);
    } catch (u) {
      if (w(s), u !== u + 0) throw u;
      y(1, 0);
    }
  }
  function la(t, e, r, n, o, i) {
    var s = g();
    try {
      b(t)(e, r, n, o, i);
    } catch (u) {
      if (w(s), u !== u + 0) throw u;
      y(1, 0);
    }
  }
  function ca(t, e, r, n, o, i, s) {
    var u = g();
    try {
      return b(t)(e, r, n, o, i, s);
    } catch (l) {
      if (w(u), l !== l + 0) throw l;
      y(1, 0);
    }
  }
  function da(t, e, r, n, o, i, s, u) {
    var l = g();
    try {
      return b(t)(e, r, n, o, i, s, u);
    } catch (f) {
      if (w(l), f !== f + 0) throw f;
      y(1, 0);
    }
  }
  function fa(t) {
    var e = g();
    try {
      return b(t)();
    } catch (r) {
      if (w(e), r !== r + 0) throw r;
      y(1, 0);
    }
  }
  function ha(t, e, r, n, o, i, s, u, l) {
    var f = g();
    try {
      return b(t)(e, r, n, o, i, s, u, l);
    } catch (p) {
      if (w(f), p !== p + 0) throw p;
      y(1, 0);
    }
  }
  function pa(t, e, r, n, o, i, s) {
    var u = g();
    try {
      return b(t)(e, r, n, o, i, s);
    } catch (l) {
      if (w(u), l !== l + 0) throw l;
      y(1, 0);
    }
  }
  function ma(t, e, r, n) {
    var o = g();
    try {
      return b(t)(e, r, n);
    } catch (i) {
      if (w(o), i !== i + 0) throw i;
      y(1, 0);
    }
  }
  function ya(t, e, r, n) {
    var o = g();
    try {
      return b(t)(e, r, n);
    } catch (i) {
      if (w(o), i !== i + 0) throw i;
      y(1, 0);
    }
  }
  function va(t, e, r, n, o, i, s, u) {
    var l = g();
    try {
      b(t)(e, r, n, o, i, s, u);
    } catch (f) {
      if (w(l), f !== f + 0) throw f;
      y(1, 0);
    }
  }
  function wa(t, e, r, n, o, i) {
    var s = g();
    try {
      return b(t)(e, r, n, o, i);
    } catch (u) {
      if (w(s), u !== u + 0) throw u;
      y(1, 0);
    }
  }
  function ga(t, e, r, n, o, i, s, u, l, f) {
    var p = g();
    try {
      b(t)(e, r, n, o, i, s, u, l, f);
    } catch (m) {
      if (w(p), m !== m + 0) throw m;
      y(1, 0);
    }
  }
  function ba(t, e, r) {
    var n = g();
    try {
      return b(t)(e, r);
    } catch (o) {
      if (w(n), o !== o + 0) throw o;
      y(1, 0);
    }
  }
  function Ca(t, e, r, n, o) {
    var i = g();
    try {
      return b(t)(e, r, n, o);
    } catch (s) {
      if (w(i), s !== s + 0) throw s;
      y(1, 0);
    }
  }
  function $a(t, e, r, n, o, i, s) {
    var u = g();
    try {
      b(t)(e, r, n, o, i, s);
    } catch (l) {
      if (w(u), l !== l + 0) throw l;
      y(1, 0);
    }
  }
  function Ta(t, e, r, n) {
    var o = g();
    try {
      return b(t)(e, r, n);
    } catch (i) {
      if (w(o), i !== i + 0) throw i;
      y(1, 0);
    }
  }
  function Ea(t, e, r, n, o, i, s, u, l, f, p, m) {
    var $ = g();
    try {
      return b(t)(e, r, n, o, i, s, u, l, f, p, m);
    } catch (E) {
      if (w($), E !== E + 0) throw E;
      y(1, 0);
    }
  }
  function _a(t, e, r, n, o, i, s, u, l, f, p, m, $, E, x, P) {
    var _ = g();
    try {
      b(t)(e, r, n, o, i, s, u, l, f, p, m, $, E, x, P);
    } catch (T) {
      if (w(_), T !== T + 0) throw T;
      y(1, 0);
    }
  }
  function Aa(t, e, r, n, o, i, s) {
    var u = g();
    try {
      return De(t, e, r, n, o, i, s);
    } catch (l) {
      if (w(u), l !== l + 0) throw l;
      y(1, 0);
    }
  }
  function Pa(t, e, r, n, o) {
    var i = g();
    try {
      return Ie(t, e, r, n, o);
    } catch (s) {
      if (w(i), s !== s + 0) throw s;
      y(1, 0);
    }
  }
  function Oa() {
    rr();
    function t() {
      var e, r;
      d.calledRun = !0, !ht && (nr(), (e = qt) === null || e === void 0 || e(d), (r = d.onRuntimeInitialized) === null || r === void 0 || r.call(d), ar());
    }
    d.setStatus ? (d.setStatus("Running..."), setTimeout(() => {
      setTimeout(() => d.setStatus(""), 1), t();
    }, 1)) : t();
  }
  var dt;
  return dt = await dr(), Oa(), Kt ? c = d : c = new Promise((t, e) => {
    qt = t, Yt = e;
  }), c;
}
function Ne(a) {
  return ze(Xt, a);
}
function _o() {
  return eo(Xt);
}
function Ao(a) {
  Ne({
    overrides: a,
    equalityFn: Object.is,
    fireImmediately: !1
  });
}
async function ao(a, c) {
  return no(Xt, a, c);
}
const Po = "8f2a99b0c9fdf8123d0152ba4761fc7dbf58c7de7e4937d1e134aae17e2ad795", Qe = [
  ["aztec", "Aztec"],
  ["aztec_code", "AztecCode"],
  ["aztec_rune", "AztecRune"],
  ["code_128", "Code128"],
  ["code_39", "Code39"],
  ["code_39_standard", "Code39Std"],
  ["code_39_extended", "Code39Ext"],
  ["code_32", "Code32"],
  ["pzn", "PZN"],
  ["code_93", "Code93"],
  ["codabar", "Codabar"],
  ["databar", "DataBar"],
  ["databar_omni", "DataBarOmni"],
  ["databar_stacked", "DataBarStk"],
  ["databar_stacked_omni", "DataBarStkOmni"],
  ["databar_expanded", "DataBarExp"],
  ["databar_expanded_stacked", "DataBarExpStk"],
  ["databar_limited", "DataBarLtd"],
  ["data_matrix", "DataMatrix"],
  ["dx_film_edge", "DXFilmEdge"],
  ["ean_13", "EAN13"],
  ["ean_upc", "EANUPC"],
  ["isbn", "ISBN"],
  ["ean_8", "EAN8"],
  ["itf", "ITF"],
  ["itf_14", "ITF14"],
  ["maxi_code", "MaxiCode"],
  ["micro_qr_code", "MicroQRCode"],
  ["pdf417", "PDF417"],
  ["compact_pdf417", "CompactPDF417"],
  ["qr_code", "QRCode"],
  ["qr_code_model_1", "QRCodeModel1"],
  ["qr_code_model_2", "QRCodeModel2"],
  ["rm_qr_code", "RMQRCode"],
  ["upc_a", "UPCA"],
  ["upc_e", "UPCE"],
  ["other_barcode", "OtherBarcode"],
  ["linear_codes", "AllLinear"],
  ["matrix_codes", "AllMatrix"],
  ["gs1_codes", "AllGS1"],
  ["retail_codes", "AllRetail"],
  ["industrial_codes", "AllIndustrial"],
  ["any", "All"]
], oo = [...Qe, ["unknown"]].map((a) => a[0]), Qt = new Map(
  Qe
);
function io(a) {
  for (const [c, h] of Qt)
    if (a === h)
      return c;
  return "unknown";
}
function so(a) {
  if (Xe(a))
    return {
      width: a.naturalWidth,
      height: a.naturalHeight
    };
  if (qe(a))
    return {
      width: a.width.baseVal.value,
      height: a.height.baseVal.value
    };
  if (Ye(a))
    return {
      width: a.videoWidth,
      height: a.videoHeight
    };
  if (Je(a))
    return {
      width: a.width,
      height: a.height
    };
  if (tr(a))
    return {
      width: a.displayWidth,
      height: a.displayHeight
    };
  if (Ze(a))
    return {
      width: a.width,
      height: a.height
    };
  if (Ke(a))
    return {
      width: a.width,
      height: a.height
    };
  throw new TypeError(
    "The provided value is not of type '(Blob or HTMLCanvasElement or HTMLImageElement or HTMLVideoElement or ImageBitmap or ImageData or OffscreenCanvas or SVGImageElement or VideoFrame)'."
  );
}
function Xe(a) {
  var c, h;
  try {
    return a instanceof ((h = (c = a == null ? void 0 : a.ownerDocument) == null ? void 0 : c.defaultView) == null ? void 0 : h.HTMLImageElement);
  } catch {
    return !1;
  }
}
function qe(a) {
  var c, h;
  try {
    return a instanceof ((h = (c = a == null ? void 0 : a.ownerDocument) == null ? void 0 : c.defaultView) == null ? void 0 : h.SVGImageElement);
  } catch {
    return !1;
  }
}
function Ye(a) {
  var c, h;
  try {
    return a instanceof ((h = (c = a == null ? void 0 : a.ownerDocument) == null ? void 0 : c.defaultView) == null ? void 0 : h.HTMLVideoElement);
  } catch {
    return !1;
  }
}
function Ze(a) {
  var c, h;
  try {
    return a instanceof ((h = (c = a == null ? void 0 : a.ownerDocument) == null ? void 0 : c.defaultView) == null ? void 0 : h.HTMLCanvasElement);
  } catch {
    return !1;
  }
}
function Je(a) {
  try {
    return a instanceof ImageBitmap || Object.prototype.toString.call(a) === "[object ImageBitmap]";
  } catch {
    return !1;
  }
}
function Ke(a) {
  try {
    return a instanceof OffscreenCanvas || Object.prototype.toString.call(a) === "[object OffscreenCanvas]";
  } catch {
    return !1;
  }
}
function tr(a) {
  try {
    return a instanceof VideoFrame || Object.prototype.toString.call(a) === "[object VideoFrame]";
  } catch {
    return !1;
  }
}
function uo(a) {
  try {
    return a instanceof Blob || Object.prototype.toString.call(a) === "[object Blob]";
  } catch {
    return !1;
  }
}
function lo(a) {
  try {
    return a instanceof ImageData || Object.prototype.toString.call(a) === "[object ImageData]";
  } catch {
    return !1;
  }
}
function co(a, c) {
  try {
    const h = new OffscreenCanvas(a, c);
    if (h.getContext("2d") instanceof OffscreenCanvasRenderingContext2D)
      return h;
    throw void 0;
  } catch {
    const h = document.createElement("canvas");
    return h.width = a, h.height = c, h;
  }
}
async function er(a) {
  if (Xe(a) && !await mo(a))
    throw new DOMException(
      "Failed to load or decode HTMLImageElement.",
      "InvalidStateError"
    );
  if (qe(a) && !await yo(a))
    throw new DOMException(
      "Failed to load or decode SVGImageElement.",
      "InvalidStateError"
    );
  if (tr(a) && vo(a))
    throw new DOMException("VideoFrame is closed.", "InvalidStateError");
  if (Ye(a) && (a.readyState === 0 || a.readyState === 1))
    throw new DOMException("Invalid element or state.", "InvalidStateError");
  if (Je(a) && go(a))
    throw new DOMException(
      "The image source is detached.",
      "InvalidStateError"
    );
  const { width: c, height: h } = so(a);
  if (c === 0 || h === 0)
    return null;
  const d = co(c, h).getContext("2d");
  d.drawImage(a, 0, 0);
  try {
    return d.getImageData(0, 0, c, h);
  } catch {
    throw new DOMException("Source would taint origin.", "SecurityError");
  }
}
async function fo(a) {
  let c;
  try {
    c = await createImageBitmap(a);
  } catch {
    try {
      if (globalThis.Image) {
        c = new Image();
        let d = "";
        try {
          d = URL.createObjectURL(a), c.src = d, await c.decode();
        } finally {
          URL.revokeObjectURL(d);
        }
      } else
        return a;
    } catch {
      throw new DOMException(
        "Failed to load or decode Blob.",
        "InvalidStateError"
      );
    }
  }
  return await er(c);
}
function ho(a) {
  const { width: c, height: h } = a;
  if (c === 0 || h === 0)
    return null;
  const v = a.getContext("2d");
  try {
    return v.getImageData(0, 0, c, h);
  } catch {
    throw new DOMException("Source would taint origin.", "SecurityError");
  }
}
async function po(a) {
  if (uo(a))
    return await fo(a);
  if (lo(a)) {
    if (wo(a))
      throw new DOMException(
        "The image data has been detached.",
        "InvalidStateError"
      );
    return a;
  }
  return Ze(a) || Ke(a) ? ho(a) : await er(a);
}
async function mo(a) {
  try {
    return await a.decode(), !0;
  } catch {
    return !1;
  }
}
async function yo(a) {
  var c;
  try {
    return await ((c = a.decode) == null ? void 0 : c.call(a)), !0;
  } catch {
    return !1;
  }
}
function vo(a) {
  return a.format === null;
}
function wo(a) {
  return a.data.buffer.byteLength === 0;
}
function go(a) {
  return a.width === 0 && a.height === 0;
}
function He(a, c) {
  return bo(a) ? new DOMException(`${c}: ${a.message}`, a.name) : Co(a) ? new a.constructor(`${c}: ${a.message}`) : new Error(`${c}: ${a}`);
}
function bo(a) {
  return a instanceof DOMException || Object.prototype.toString.call(a) === "[object DOMException]";
}
function Co(a) {
  return a instanceof Error || Object.prototype.toString.call(a) === "[object Error]";
}
var ft;
class Oo {
  constructor(c = {}) {
    We(this, ft);
    var h;
    try {
      const v = (h = c == null ? void 0 : c.formats) == null ? void 0 : h.filter(
        (d) => d !== "unknown"
      );
      if ((v == null ? void 0 : v.length) === 0)
        throw new TypeError("Hint option provided, but is empty.");
      for (const d of v != null ? v : [])
        if (!Qt.has(d))
          throw new TypeError(
            `Failed to read the 'formats' property from 'BarcodeDetectorOptions': The provided value '${d}' is not a valid enum value of type BarcodeFormat.`
          );
      ke(this, ft, v != null ? v : []), Ne({ fireImmediately: !0 }).catch(() => {
      });
    } catch (v) {
      throw He(
        v,
        "Failed to construct 'BarcodeDetector'"
      );
    }
  }
  static async getSupportedFormats() {
    return oo.filter((c) => c !== "unknown");
  }
  async detect(c) {
    try {
      const h = await po(c);
      if (h === null)
        return [];
      let v;
      const d = {
        textMode: "Plain",
        formats: Ue(this, ft).map((D) => Qt.get(D))
      };
      try {
        v = await ao(h, d);
      } catch (D) {
        throw console.error(D), new DOMException(
          "Barcode detection service unavailable.",
          "NotSupportedError"
        );
      }
      return v.map((D) => {
        const {
          topLeft: { x: I, y: S },
          topRight: { x: O, y: R },
          bottomLeft: { x: k, y: Q },
          bottomRight: { x: V, y: Y }
        } = D.position, at = Math.min(I, O, k, V), G = Math.min(S, R, Q, Y), Z = Math.max(I, O, k, V), ht = Math.max(S, R, Q, Y);
        return {
          boundingBox: new DOMRectReadOnly(
            at,
            G,
            Z - at,
            ht - G
          ),
          rawValue: D.text,
          format: io(D.format),
          cornerPoints: [
            {
              x: I,
              y: S
            },
            {
              x: O,
              y: R
            },
            {
              x: V,
              y: Y
            },
            {
              x: k,
              y: Q
            }
          ]
        };
      });
    } catch (h) {
      throw He(
        h,
        "Failed to execute 'detect' on 'BarcodeDetector'"
      );
    }
  }
}
ft = new WeakMap();
export {
  Oo as BarcodeDetector,
  Eo as ZXING_CPP_COMMIT,
  Po as ZXING_WASM_SHA256,
  To as ZXING_WASM_VERSION,
  Ne as prepareZXingModule,
  _o as purgeZXingModule,
  Ao as setZXingModuleOverrides
};
