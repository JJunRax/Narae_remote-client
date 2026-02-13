// Command types from admin data channel
interface MouseMoveCmd {
    type: "mousemove";
    x: number;
    y: number;
    screen_w: number;
    screen_h: number;
}

interface MouseClickCmd {
    type: "mousedown" | "mouseup" | "click";
    button: number;
}

interface KeyCmd {
    type: "keydown" | "keyup";
    key: string;
}

export type ValidatedCommand = MouseMoveCmd | MouseClickCmd | KeyCmd;

// Allowed key names (matches map_key in Rust)
const ALLOWED_KEYS = new Set([
    "Enter", "Backspace", "Tab", "Escape", "Delete",
    "Home", "End", "PageUp", "PageDown",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "Control", "Shift", "Alt", "Meta",
    "F1", "F2", "F3", "F4", "F5", "F6",
    "F7", "F8", "F9", "F10", "F11", "F12",
    " ", "CapsLock", "Insert", "PrintScreen", "ScrollLock", "Pause",
]);

function isAllowedKey(key: string): boolean {
    if (ALLOWED_KEYS.has(key)) return true;
    // Single character (letter, number, symbol)
    if (key.length === 1) return true;
    return false;
}

// Rate limiter
class RateLimiter {
    private timestamps: number[] = [];
    private maxPerSecond: number;

    constructor(maxPerSecond: number) {
        this.maxPerSecond = maxPerSecond;
    }

    allow(): boolean {
        const now = Date.now();
        const cutoff = now - 1000;
        // Remove old timestamps
        while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
            this.timestamps.shift();
        }
        if (this.timestamps.length >= this.maxPerSecond) {
            return false;
        }
        this.timestamps.push(now);
        return true;
    }
}

const mouseMoveLimit = new RateLimiter(200);
const mouseClickLimit = new RateLimiter(50);
const keyLimit = new RateLimiter(100);

export function validateCommand(raw: unknown): ValidatedCommand | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;

    switch (obj.type) {
        case "mousemove": {
            if (!mouseMoveLimit.allow()) return null;
            const x = typeof obj.x === "number" ? Math.max(0, Math.min(1, obj.x)) : null;
            const y = typeof obj.y === "number" ? Math.max(0, Math.min(1, obj.y)) : null;
            const sw = typeof obj.screen_w === "number" && obj.screen_w > 0 && obj.screen_w <= 15360 ? Math.floor(obj.screen_w) : null;
            const sh = typeof obj.screen_h === "number" && obj.screen_h > 0 && obj.screen_h <= 8640 ? Math.floor(obj.screen_h) : null;
            if (x === null || y === null || sw === null || sh === null) return null;
            return { type: "mousemove", x, y, screen_w: sw, screen_h: sh };
        }

        case "mousedown":
        case "mouseup":
        case "click": {
            if (!mouseClickLimit.allow()) return null;
            const button = typeof obj.button === "number" ? obj.button : 0;
            if (button !== 0 && button !== 1 && button !== 2) return null;
            return { type: obj.type as "mousedown" | "mouseup" | "click", button };
        }

        case "keydown":
        case "keyup": {
            if (!keyLimit.allow()) return null;
            const key = typeof obj.key === "string" ? obj.key : null;
            if (!key || key.length > 20 || !isAllowedKey(key)) return null;
            return { type: obj.type as "keydown" | "keyup", key };
        }

        default:
            return null;
    }
}
