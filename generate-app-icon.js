// Generates the athlete portal icons (PWA + favicon + apple-touch-icon) from the
// OFFCOMFRT brand photo: a dark, grain-textured field split by a thin white bar.
//
// Pipeline: compress the committed master to 1024px -> box-downsample to each
// target size -> quantise to N levels per channel -> PNG with per-row adaptive
// filtering + zlib level 9. Plain sips scaling of this photo yields ~299 KB at
// 512px because the film grain defeats PNG's row prediction; quantising plus
// adaptive filters pulls that down by roughly an order of magnitude.
//
// Requires macOS `sips` for the JPEG decode step (Node has no built-in JPEG
// decoder). Run: node generate-app-icon.js [--levels=48]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const os = require('os');

const OUT_DIR = path.join(__dirname, 'public', 'images');
const SOURCE = path.join(OUT_DIR, 'icon-source.jpg');
const MASTER_SIZE = 1024;

const levelsArg = process.argv.find(a => a.startsWith('--levels='));
const LEVELS = levelsArg ? Math.max(2, parseInt(levelsArg.split('=')[1], 10)) : 48;

// ---------------------------------------------------------------- PNG decode
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePng(buf) {
    if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
    let off = 8;
    let ihdr = null;
    const idat = [];
    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            ihdr = {
                width: data.readUInt32BE(0),
                height: data.readUInt32BE(4),
                bitDepth: data[8],
                colorType: data[9],
                interlace: data[12]
            };
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        off += 12 + len;
    }
    if (!ihdr) throw new Error('missing IHDR');
    if (ihdr.bitDepth !== 8) throw new Error('only 8-bit PNG supported, got ' + ihdr.bitDepth);
    if (ihdr.interlace !== 0) throw new Error('interlaced PNG unsupported');
    const CH = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
    if (!CH) throw new Error('unsupported color type ' + ihdr.colorType);

    const raw = zlib.inflateSync(Buffer.concat(idat));
    const { width, height } = ihdr;
    const stride = width * CH;
    const out = Buffer.alloc(stride * height);
    const bpp = CH;

    // Undo the per-scanline filters (PNG spec §9.2).
    const paeth = (a, b, c) => {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
    };

    for (let y = 0; y < height; y++) {
        const ft = raw[y * (stride + 1)];
        const src = y * (stride + 1) + 1;
        const dst = y * stride;
        for (let x = 0; x < stride; x++) {
            const v = raw[src + x];
            const left = x >= bpp ? out[dst + x - bpp] : 0;
            const up = y > 0 ? out[dst - stride + x] : 0;
            const upLeft = y > 0 && x >= bpp ? out[dst - stride + x - bpp] : 0;
            let val;
            switch (ft) {
                case 0: val = v; break;
                case 1: val = v + left; break;
                case 2: val = v + up; break;
                case 3: val = v + ((left + up) >> 1); break;
                case 4: val = v + paeth(left, up, upLeft); break;
                default: throw new Error('bad filter type ' + ft);
            }
            out[dst + x] = val & 0xff;
        }
    }
    return { width, height, channels: CH, data: out };
}

// ------------------------------------------------------------ bar anchor
// Locate the white bar so the tight favicon crop can centre on the mark
// instead of on the frame. Returns the bar's centroid in master pixels.
function barAnchor(img) {
    const { width: W, height: H, channels: CH, data } = img;
    let bestY = H >> 1, bestMean = -1;
    // The bar sits near the middle; ignore the outer thirds which are just field.
    for (let y = Math.floor(H * 0.3); y < Math.floor(H * 0.7); y++) {
        let sum = 0;
        for (let x = 0; x < W; x += 4) {
            const i = (y * W + x) * CH;
            sum += Math.max(data[i], data[i + 1], data[i + 2]);
        }
        const mean = sum / Math.ceil(W / 4);
        if (mean > bestMean) { bestMean = mean; bestY = y; }
    }
    // Horizontal centroid of everything clearly brighter than the field.
    let sx = 0, n = 0;
    for (let x = 0; x < W; x++) {
        const i = (bestY * W + x) * CH;
        if (Math.max(data[i], data[i + 1], data[i + 2]) > bestMean - 12) { sx += x; n++; }
    }
    return { x: n ? Math.round(sx / n) : W >> 1, y: bestY };
}

// Centred square crop of `side` px, clamped so it never runs off the master.
function cropSquare(img, side, cx, cy) {
    const { width: W, height: H, channels: CH, data } = img;
    const x0 = Math.max(0, Math.min(W - side, cx - (side >> 1)));
    const y0 = Math.max(0, Math.min(H - side, cy - (side >> 1)));
    const out = Buffer.alloc(side * side * CH);
    for (let y = 0; y < side; y++) {
        data.copy(out, y * side * CH, ((y0 + y) * W + x0) * CH, ((y0 + y) * W + x0 + side) * CH);
    }
    return { width: side, height: side, channels: CH, data: out };
}

// ---------------------------------------------------------- box downsample
// Area-averaging resample. Works for any size ratio, which keeps the grain
// averaged out instead of aliased when the ratio is not an integer.
function resample(src, size) {
    const { width: SW, height: SH, channels: CH, data } = src;
    const out = Buffer.alloc(size * size * CH);
    const scale = SW / size;
    for (let y = 0; y < size; y++) {
        const y0 = y * scale, y1 = y0 + scale;
        const iy0 = Math.floor(y0), iy1 = Math.min(SH, Math.ceil(y1));
        for (let x = 0; x < size; x++) {
            const x0 = x * scale, x1 = x0 + scale;
            const ix0 = Math.floor(x0), ix1 = Math.min(SW, Math.ceil(x1));
            const acc = new Float64Array(CH);
            let wsum = 0;
            for (let sy = iy0; sy < iy1; sy++) {
                const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
                if (wy <= 0) continue;
                for (let sx = ix0; sx < ix1; sx++) {
                    const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
                    if (wx <= 0) continue;
                    const w = wx * wy;
                    const i = (sy * SW + sx) * CH;
                    for (let c = 0; c < CH; c++) acc[c] += data[i + c] * w;
                    wsum += w;
                }
            }
            const o = (y * size + x) * CH;
            for (let c = 0; c < CH; c++) out[o + c] = Math.round(acc[c] / wsum);
        }
    }
    return { width: size, height: size, channels: CH, data: out };
}

// --------------------------------------------------------------- quantise
// Collapse each channel onto N evenly spaced levels. The photo is a smooth
// gradient plus grain, so this is where most of the compression comes from.
function quantise(img, levels) {
    const lut = Buffer.alloc(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.round((v / 255) * (levels - 1)) / (levels - 1) * 255);
    const { data, channels: CH } = img;
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += CH) {
        for (let c = 0; c < CH; c++) out[i + c] = lut[data[i + c]];
    }
    return { ...img, data: out };
}

// --------------------------------------------------------------- PNG encode
const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

function paethPredict(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
}

function encodePng(img, { alpha = false } = {}) {
    const { width, height, channels: SRC_CH, data } = img;
    const CH = alpha ? 4 : 3;
    const colorType = alpha ? 6 : 2;
    const stride = width * CH;

    // Normalise to the output channel count (drop or add alpha).
    const px = Buffer.alloc(stride * height);
    for (let i = 0, p = 0; i < data.length; i += SRC_CH, p += CH) {
        px[p] = data[i];
        px[p + 1] = data[i + 1];
        px[p + 2] = data[i + 2];
        if (alpha) px[p + 3] = SRC_CH === 4 ? data[i + 3] : 255;
    }

    // Per-row adaptive filtering: pick whichever of the five filters minimises
    // the sum of absolute signed residuals for that row.
    const filtered = Buffer.alloc((stride + 1) * height);
    const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
    for (let y = 0; y < height; y++) {
        const rowAt = y * stride;
        const prevAt = (y - 1) * stride;
        let best = 0, bestScore = Infinity;
        for (let f = 0; f < 5; f++) {
            const out = cand[f];
            let score = 0;
            for (let x = 0; x < stride; x++) {
                const cur = px[rowAt + x];
                const left = x >= CH ? px[rowAt + x - CH] : 0;
                const up = y > 0 ? px[prevAt + x] : 0;
                const upLeft = y > 0 && x >= CH ? px[prevAt + x - CH] : 0;
                let pred;
                switch (f) {
                    case 0: pred = 0; break;
                    case 1: pred = left; break;
                    case 2: pred = up; break;
                    case 3: pred = (left + up) >> 1; break;
                    default: pred = paethPredict(left, up, upLeft);
                }
                const v = (cur - pred) & 0xff;
                out[x] = v;
                score += v < 128 ? v : 256 - v;
            }
            if (score < bestScore) { bestScore = score; best = f; }
        }
        const base = y * (stride + 1);
        filtered[base] = best;
        cand[best].copy(filtered, base + 1);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = colorType;

    return Buffer.concat([
        SIG,
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(filtered, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

// ------------------------------------------------------------------- main
if (!fs.existsSync(SOURCE)) {
    console.error('Missing master image:', SOURCE);
    console.error('Place the brand photo there (any JPEG) and re-run.');
    process.exit(1);
}

const tmp = path.join(os.tmpdir(), `offcomfrt-icon-master-${process.pid}.png`);
execFileSync('sips', ['-s', 'format', 'png', '-Z', String(MASTER_SIZE), SOURCE, '--out', tmp], { stdio: 'ignore' });
const master = decodePng(fs.readFileSync(tmp));
fs.rmSync(tmp, { force: true });
console.log(`master decoded: ${master.width}x${master.height} (${master.channels}ch) -> quantise ${LEVELS} levels`);

const anchor = barAnchor(master);
console.log(`bar anchor: x=${anchor.x} y=${anchor.y} of ${master.width}`);

// cropFactor 1 = full frame; 2 = tight crop for the favicons, where a 1px-tall
// white bar on a 22%-wide frame would average away into the grain.
const TARGETS = [
    ['app-icon.png', 512, false, 1],
    ['app-icon-192.png', 192, false, 1],
    ['apple-touch-icon.png', 180, false, 1],
    ['favicon-32.png', 32, false, 2],
    ['favicon-16.png', 16, false, 2]
];

let total = 0;
for (const [file, size, alpha, cropFactor] of TARGETS) {
    const base = cropFactor === 1
        ? master
        : cropSquare(master, Math.round(master.width / cropFactor), anchor.x, anchor.y);
    const scaled = quantise(resample(base, size), LEVELS);
    const png = encodePng(scaled, { alpha });
    fs.writeFileSync(path.join(OUT_DIR, file), png);
    total += png.length;
    console.log(`${file.padEnd(22)} ${String(size).padStart(4)}px  ${String(png.length).padStart(7)} bytes`);
}
console.log(`total ${total} bytes across ${TARGETS.length} files`);
