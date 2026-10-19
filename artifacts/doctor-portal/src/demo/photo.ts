import { hash } from "./simulate";

/**
 * A drawn stand-in for a meal photo in the demo: a plate on a table, with food shapes picked from
 * the meal's name, labeled as a sample. PNG, like the app's uploads.
 */

type Draw = (ctx: CanvasRenderingContext2D, r: () => number) => void;

const blob = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
};

const FOODS: [RegExp, Draw][] = [
  [
    /pasta|spaghetti|noodle|ramen|mac|lasagna|alfredo/i,
    (ctx, r) => {
      ctx.strokeStyle = "#e8c170";
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        const y = 205 + i * 14;
        ctx.moveTo(225, y);
        ctx.bezierCurveTo(285, y - 40 * r(), 355, y + 40 * r(), 415, y - 10);
        ctx.stroke();
      }
      for (let i = 0; i < 4; i++) blob(ctx, 250 + r() * 140, 220 + r() * 100, 24, 24, "#8a3b20");
    },
  ],
  [
    /pizza/i,
    (ctx, r) => {
      for (let i = 0; i < 3; i++) {
        const a = (i * 2 * Math.PI) / 3 + r();
        ctx.fillStyle = "#e9b65c";
        ctx.beginPath();
        ctx.moveTo(320, 260);
        ctx.arc(320, 260, 120, a, a + 1.6);
        ctx.closePath();
        ctx.fill();
        for (let j = 0; j < 3; j++) {
          const b = a + 0.3 + j * 0.45;
          blob(ctx, 320 + Math.cos(b) * 75, 260 + Math.sin(b) * 75, 12, 12, "#b23a2a");
        }
      }
    },
  ],
  [
    /pancake|waffle/i,
    (ctx, r) => {
      for (let i = 0; i < 3; i++) blob(ctx, 320, 285 - i * 18, 105, 42, i % 2 ? "#d79a4a" : "#e5ad5f");
      for (let i = 0; i < 6; i++) blob(ctx, 260 + r() * 120, 225 + r() * 40, 11, 11, "#c22f45");
    },
  ],
  [
    /salad|broccoli|bowl|poke/i,
    (ctx, r) => {
      for (let i = 0; i < 14; i++) blob(ctx, 230 + r() * 180, 190 + r() * 140, 22, 15, i % 3 ? "#5c9e3d" : "#3f7d2b");
      for (let i = 0; i < 5; i++) blob(ctx, 250 + r() * 140, 210 + r() * 100, 16, 12, i % 2 ? "#e07a3c" : "#f2efe6");
    },
  ],
  [
    /sandwich|toast|bagel|burrito|wrap|taco|quesadilla|burger|grilled cheese|pb&j/i,
    (ctx) => {
      ctx.fillStyle = "#d9a55b";
      ctx.fillRect(235, 205, 170, 105);
      ctx.fillStyle = "#6d9c45";
      ctx.fillRect(235, 248, 170, 14);
      ctx.fillStyle = "#c06a4a";
      ctx.fillRect(235, 262, 170, 12);
      blob(ctx, 420, 320, 30, 22, "#c8343c");
    },
  ],
  [
    /rice|curry|stir|teriyaki|enchilada|chicken|salmon|fish|steak|roast|beans/i,
    (ctx, r) => {
      blob(ctx, 280, 275, 85, 60, "#f3eee0");
      for (let i = 0; i < 4; i++) blob(ctx, 365 + r() * 40, 210 + r() * 90, 38, 26, i % 2 ? "#b8743c" : "#d58e4c");
      for (let i = 0; i < 5; i++) blob(ctx, 250 + r() * 70, 315 + r() * 20, 12, 9, "#5c9e3d");
    },
  ],
  [
    /oat|cereal|yogurt|granola|smoothie|soup|ice cream/i,
    (ctx, r) => {
      blob(ctx, 320, 265, 115, 82, "#f1e4c7");
      for (let i = 0; i < 10; i++) blob(ctx, 250 + r() * 140, 220 + r() * 90, 10, 10, i % 2 ? "#5b3c8f" : "#c22f45");
    },
  ],
];

const fallback: Draw = (ctx, r) => {
  const colors = ["#d58e4c", "#5c9e3d", "#e9b65c", "#c06a4a", "#f3eee0"];
  for (let i = 0; i < 6; i++) blob(ctx, 250 + r() * 140, 210 + r() * 110, 34, 26, colors[i % colors.length]!);
};

export async function drawMealPhoto(foodName: string, seed: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d")!;
  let s = hash(seed) || 1;
  const r = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const table = ctx.createLinearGradient(0, 0, 640, 480);
  table.addColorStop(0, "#7a5136");
  table.addColorStop(1, "#5a3a26");
  ctx.fillStyle = table;
  ctx.fillRect(0, 0, 640, 480);
  blob(ctx, 330, 275, 205, 170, "rgba(0,0,0,0.25)");
  blob(ctx, 320, 262, 200, 165, "#f7f5f0");
  ctx.strokeStyle = "#ddd8cc";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(320, 262, 150, 122, 0, 0, Math.PI * 2);
  ctx.stroke();

  (FOODS.find(([re]) => re.test(foodName))?.[1] ?? fallback)(ctx, r);

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 440, 640, 40);
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 18px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`Sample photo · ${foodName}`, 320, 466);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the photo"))), "image/png"),
  );
}
