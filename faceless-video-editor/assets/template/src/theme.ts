// Style presets. project.json -> "style" picks one. NEVER inline colors,
// fonts, easings or spring configs in components: add them here.
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadInterTight } from "@remotion/google-fonts/InterTight";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadBengali } from "@remotion/google-fonts/NotoSansBengali";
import { loadFont as loadDevanagari } from "@remotion/google-fonts/NotoSansDevanagari";
import { Easing } from "remotion";

const montserrat = loadMontserrat("normal", { weights: ["800", "900"], subsets: ["latin"] }).fontFamily;
const anton = loadAnton("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
const inter = loadInter("normal", { weights: ["500", "600", "800"], subsets: ["latin"] }).fontFamily;
// Editorial display faces: a modern serif for documentary, a tight grotesk for minimal.
const fraunces = loadFraunces("normal", { weights: ["600"], subsets: ["latin"] }).fontFamily;
const interTight = loadInterTight("normal", { weights: ["600", "700"], subsets: ["latin"] }).fontFamily;
// Per-glyph fallbacks so Bengali / Hindi scripts render in a heavy weight too.
// Add another Noto family the same way for other scripts (Arabic, Tamil, ...).
const scripts = [
  loadBengali("normal", { weights: ["800"], subsets: ["bengali"] }).fontFamily,
  loadDevanagari("normal", { weights: ["800"], subsets: ["devanagari"] }).fontFamily,
].join(", ");
const stack = (primary: string) => `${primary}, ${scripts}, sans-serif`;

export type Style = {
  colors: {
    bg: string;
    bgAlt: string;
    primary: string; // active caption word + hero accents. One hero per frame.
    accent: string;
    text: string;
    outline: string;
    scrim: string;
  };
  fonts: { caption: string; emphasis: string; label: string };
  // Editorial: on-screen text set like a documentary / premium explainer - mixed
  // case, a display face, text revealed by a mask (no bounce, no outline, no
  // highlighter boxes). Off (bold): the punchy Shorts look.
  editorial: boolean;
  // Decorative lines next to text (a dash before a label, a rule above a title, a
  // bar beside a text pop). Off unless the reference uses them (project "textRules").
  rules: boolean;
  captionWeight: number;
  uppercase: boolean;
  grade: number; // soft-light tint opacity
  grain: number;
};

export const STYLES: Record<string, Style> = {
  // High-energy Shorts/Reels/TikTok: yellow active word, heavy outline.
  bold: {
    colors: { bg: "#07070B", bgAlt: "#16121F", primary: "#FFD60A", accent: "#FF3B5C", text: "#FFFFFF", outline: "#000000", scrim: "rgba(0,0,0,0.55)" },
    fonts: { caption: stack(montserrat), emphasis: stack(anton), label: stack(montserrat) },
    editorial: false,
    rules: false,
    captionWeight: 900,
    uppercase: true,
    grade: 0.1,
    grain: 0.06,
  },
  // Story / history / true-crime / explainer: warm amber, calmer type.
  documentary: {
    colors: { bg: "#0D0B08", bgAlt: "#1F1A12", primary: "#E9B44C", accent: "#C8553D", text: "#F5EFE6", outline: "#120E08", scrim: "rgba(10,8,5,0.6)" },
    fonts: { caption: stack(inter), emphasis: stack(fraunces), label: stack(inter) },
    editorial: true,
    rules: false,
    captionWeight: 600,
    uppercase: false,
    grade: 0.16,
    grain: 0.08,
  },
  // Tech / finance / productivity: clean, violet hero, pill highlight.
  minimal: {
    colors: { bg: "#0A0A0F", bgAlt: "#12121A", primary: "#8B5CF6", accent: "#22D3EE", text: "#F4F4F5", outline: "#000000", scrim: "rgba(5,5,10,0.5)" },
    fonts: { caption: stack(inter), emphasis: stack(interTight), label: stack(inter) },
    editorial: true,
    rules: false,
    captionWeight: 600,
    uppercase: false,
    grade: 0.12,
    grain: 0.05,
  },
};

export const getStyle = (name: string, rules = false): Style => ({ ...(STYLES[name] ?? STYLES.bold), rules });

export const ease = {
  out: Easing.bezier(0.16, 1, 0.3, 1), // entrances
  inOut: Easing.bezier(0.83, 0, 0.17, 1), // Ken Burns, moves
  in: Easing.bezier(0.7, 0, 0.84, 0), // exits only
};

export const springs = {
  snappy: { damping: 14, stiffness: 160, mass: 0.6 }, // caption words
  smooth: { damping: 20, stiffness: 90, mass: 1 }, // big blocks
  punch: { damping: 18, stiffness: 220, mass: 0.7 }, // cut zoom-punch
};

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
