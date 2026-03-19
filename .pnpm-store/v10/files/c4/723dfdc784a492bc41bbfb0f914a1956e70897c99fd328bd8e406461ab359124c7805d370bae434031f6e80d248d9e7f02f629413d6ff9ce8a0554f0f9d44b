const c = [
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
], M = {
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
}, se = c.map((e) => e[5]), G = c.filter((e) => e[1] === "*"), ie = G.map(
  (e) => e[0]
), U = c.filter((e) => e[1] !== "*"), P = U.map((e) => e[0]), le = P, z = c.filter((e) => e[2] === " "), ce = z.map((e) => e[0]), Q = c.filter(
  (e) => e[3][0] === "l"
), H = Q.map(
  (e) => e[0]
), de = H, v = c.filter(
  (e) => e[3][0] === "m"
), k = v.map(
  (e) => e[0]
), Ae = k, W = c.filter(
  (e) => e[3][1] === "r"
), fe = W.map(
  (e) => e[0]
), X = c.filter(
  (e) => e[3][2] === "w" || e[4] !== 0
), Ee = X.map(
  (e) => e[0]
), Z = c.filter(
  (e) => e[3][3] === "G"
), Re = Z.map((e) => e[0]), $ = c.filter(
  (e) => e[3][4] === "R"
), me = $.map(
  (e) => e[0]
), j = c.filter(
  (e) => e[3][4] === "I"
), Oe = j.map(
  (e) => e[0]
);
function Ce(e) {
  const t = [];
  let r;
  for (const a of c)
    if (a[1] !== "*")
      if (!r)
        a[0] === e && (t.push(a[0]), r = a[1]);
      else if (a[1] === r)
        t.push(a[0]);
      else
        break;
  return t;
}
function Se(e) {
  let t;
  for (const r of c)
    if (r[1] !== "*" && (r[2] === " " && (t = r[0]), r[0] === e))
      return t;
}
function ue(e) {
  var r;
  const t = (r = M[e]) != null ? r : e;
  for (const a of c)
    if (a[0] === t || a[5] === t)
      return a[5];
}
function D(e) {
  var t;
  return (t = M[e]) != null ? t : e;
}
function q(e) {
  return e.map(D).join(",");
}
const F = [
  "LocalAverage",
  "GlobalHistogram",
  "FixedThreshold",
  "BoolCast"
], _e = F;
function Y(e) {
  return F.indexOf(e);
}
const _ = [
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
], Ie = _;
function V(e) {
  return e === "UnicodeBig" ? _.indexOf("UTF16BE") : _.indexOf(e);
}
const w = [
  "Text",
  "Binary",
  "Mixed",
  "GS1",
  "ISO15434",
  "UnknownECI"
], Te = w;
function J(e) {
  return w[e];
}
const b = ["Ignore", "Read", "Require"], Be = b;
function K(e) {
  return b.indexOf(e);
}
const h = [
  "Plain",
  "ECI",
  "HRI",
  "Escaped",
  "Hex",
  "HexECI"
], ye = h;
function ee(e) {
  return h.indexOf(e);
}
const O = {
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
function B(e) {
  var t;
  return {
    ...e,
    formats: q(e.formats),
    binarizer: Y(e.binarizer),
    eanAddOnSymbol: K(e.eanAddOnSymbol),
    textMode: ee(e.textMode),
    characterSet: V(e.characterSet),
    tryCode39ExtendedMode: (t = e.tryCode39ExtendedMode) != null ? t : !0
  };
}
function te(e) {
  return {
    ...e,
    format: e.format,
    symbology: e.symbology,
    contentType: J(e.contentType)
  };
}
function y(e) {
  var t;
  return {
    ...e,
    image: (t = e.image && new Blob([e.image], {
      type: "image/png"
    })) != null ? t : null
  };
}
const l = {
  format: "QRCode",
  readerInit: !1,
  forceSquareDataMatrix: !1,
  ecLevel: "",
  scale: 1,
  sizeHint: 0,
  rotate: 0,
  invert: !1,
  withHRT: !1,
  withQuietZones: !0,
  addHRT: !1,
  addQuietZones: !0,
  options: ""
};
function re(e = l) {
  var I, T;
  const {
    format: t = l.format,
    sizeHint: r = l.sizeHint,
    readerInit: a = l.readerInit,
    forceSquareDataMatrix: o = l.forceSquareDataMatrix,
    ecLevel: i = l.ecLevel,
    withHRT: n,
    withQuietZones: A,
    addHRT: s,
    addQuietZones: d,
    options: C = l.options,
    scale: f,
    rotate: E = l.rotate,
    invert: L = l.invert
  } = e, S = C.split(",").map((R) => R.trim()).filter(Boolean), u = (R) => {
    const g = R.split("=")[0];
    S.some((N) => N.split("=")[0] === g) || S.push(R);
  };
  a && u("readerInit"), o && u("forceSquare"), i && u(`ecLevel=${i}`);
  const x = f != null ? f : r > 0 ? -Math.trunc(Math.abs(r)) : l.scale;
  return {
    format: D(t),
    options: S.join(","),
    scale: x,
    rotate: E,
    invert: L,
    addHRT: (I = s != null ? s : n) != null ? I : l.addHRT,
    addQuietZones: (T = d != null ? d : A) != null ? T : l.addQuietZones
  };
}
const Me = "3.0.1", De = "eb8c15ef7827ee277bd8a9b093fa1d97bd98cf67", ae = {
  locateFile: (e, t) => {
    const r = e.match(/_(.+?)\.wasm$/);
    return r ? `https://fastly.jsdelivr.net/npm/zxing-wasm@3.0.1/dist/${r[1]}/${e}` : t + e;
  }
}, m = /* @__PURE__ */ new WeakMap();
function oe(e, t) {
  return Object.is(e, t) || Object.keys(e).length === Object.keys(t).length && Object.keys(e).every(
    (r) => Object.hasOwn(t, r) && e[r] === t[r]
  );
}
function p(e, {
  overrides: t,
  equalityFn: r = oe,
  fireImmediately: a = !1
} = {}) {
  var s;
  const [o, i] = (s = m.get(e)) != null ? s : [ae], n = t != null ? t : o;
  let A;
  if (a) {
    if (i && (A = r(o, n)))
      return i;
    const d = e({
      ...n
    });
    return m.set(e, [n, d]), d;
  }
  (A != null ? A : r(o, n)) || m.set(e, [n]);
}
function Fe(e) {
  m.delete(e);
}
function ne(e) {
  const t = e.byteLength >> 2, r = new Uint8Array(t);
  for (let a = 0; a < t; a++) {
    const o = a << 2;
    r[a] = 306 * e[o] + 601 * e[o + 1] + 117 * e[o + 2] + 512 >> 10;
  }
  return r;
}
async function we(e, t, r = O) {
  const a = {
    ...O,
    ...r
  }, o = await p(e, {
    fireImmediately: !0
  });
  let i, n;
  if ("width" in t && "height" in t && "data" in t) {
    const { data: s, width: d, height: C } = t, f = ne(s), E = f.byteLength;
    if (n = o._malloc(E), !n)
      throw new Error(`Failed to allocate ${E} bytes in WASM memory`);
    try {
      o.HEAPU8.set(f, n), i = o.readBarcodesFromPixmap(
        n,
        d,
        C,
        B(a)
      );
    } finally {
      o._free(n);
    }
  } else {
    let s, d;
    if ("buffer" in t)
      [s, d] = [t.byteLength, t];
    else if ("byteLength" in t)
      [s, d] = [t.byteLength, new Uint8Array(t)];
    else if ("size" in t)
      [s, d] = [t.size, new Uint8Array(await t.arrayBuffer())];
    else
      throw new TypeError("Invalid input type");
    if (n = o._malloc(s), !n)
      throw new Error(`Failed to allocate ${s} bytes in WASM memory`);
    try {
      o.HEAPU8.set(d, n), i = o.readBarcodesFromImage(
        n,
        s,
        B(a)
      );
    } finally {
      o._free(n);
    }
  }
  const A = [];
  for (let s = 0; s < i.size(); ++s)
    A.push(
      te(i.get(s))
    );
  return A;
}
async function be(e, t, r = l) {
  const a = re(r), o = await p(e, {
    fireImmediately: !0
  });
  if (typeof t == "string")
    return y(
      o.writeBarcodeFromText(t, a)
    );
  const { byteLength: i } = t, n = o._malloc(i);
  if (!n)
    throw new Error(`Failed to allocate ${i} bytes in WASM memory`);
  try {
    o.HEAPU8.set(t, n);
    const A = o.writeBarcodeFromBytes(
      n,
      i,
      a
    );
    return y(A);
  } finally {
    o._free(n);
  }
}
const he = {
  ...O,
  formats: [...O.formats]
}, pe = { ...l };
export {
  pe as A,
  P as B,
  _ as C,
  b as E,
  Re as G,
  Oe as I,
  H as L,
  k as M,
  fe as R,
  h as T,
  De as Z,
  Fe as a,
  se as b,
  ie as c,
  ce as d,
  F as e,
  w as f,
  Ee as g,
  me as h,
  Me as i,
  le as j,
  _e as k,
  Ie as l,
  Te as m,
  he as n,
  Be as o,
  p,
  D as q,
  we as r,
  q as s,
  ue as t,
  Se as u,
  de as v,
  Ae as w,
  Ce as x,
  ye as y,
  be as z
};
