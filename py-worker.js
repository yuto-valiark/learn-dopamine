/* 裏で Python を走らせる。初回だけ Pyodide を読む。 */
importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.js");

const HELPER = `
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

class Node:
    def __init__(self, val=0, isLeaf=None, topLeft=None, topRight=None, bottomLeft=None, bottomRight=None):
        self.val = val
        self.isLeaf = isLeaf
        self.topLeft = topLeft
        self.topRight = topRight
        self.bottomLeft = bottomLeft
        self.bottomRight = bottomRight
        self.neighbors = []
        self.next = None
        self.random = None
        self.left = None
        self.right = None

def L(a):
    h = cur = ListNode(0)
    for x in a:
        cur.next = ListNode(x)
        cur = cur.next
    return h.next

def dumpL(h):
    o = []
    while h:
        o.append(h.val)
        h = h.next
    return o

def T(*a):
    if not a:
        return None
    nodes = [None if x is None else TreeNode(x) for x in a]
    root = nodes[0]
    q = [root]
    i = 1
    while q and i < len(nodes):
        n = q.pop(0)
        if n is None:
            continue
        if i < len(nodes):
            n.left = nodes[i]
            if nodes[i] is not None:
                q.append(nodes[i])
            i += 1
        if i < len(nodes):
            n.right = nodes[i]
            if nodes[i] is not None:
                q.append(nodes[i])
            i += 1
    return root
`;

let py = null;

async function boot() {
  if (!py) py = await loadPyodide();
  return py;
}

function norm(s) {
  return String(s || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^\n+|\n+$/g, "");
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    const pyodide = await boot();
    const code = msg.code || "";
    const run = msg.run || {};
    const mode = run.mode || "stdio";
    if (mode === "stdio") {
      const ios = msg.io || [];
      for (let i = 0; i < Math.min(2, ios.length); i++) {
        pyodide.globals.set("USER_CODE", code);
        pyodide.globals.set("STDIN", (ios[i].in || "") + "\n");
        pyodide.runPython(`
import sys, io
sys.stdin = io.StringIO(STDIN)
buf = io.StringIO()
sys.stdout = buf
ERR = ""
try:
    exec(USER_CODE, {})
    OUT = buf.getvalue()
except Exception as e:
    OUT = ""
    ERR = type(e).__name__ + ": " + str(e)
`);
        const err = pyodide.globals.get("ERR");
        const out = pyodide.globals.get("OUT");
        if (err) {
          self.postMessage({ ok: false, why: String(err).slice(0, 200) });
          return;
        }
        if (norm(out) !== norm(ios[i].out)) {
          self.postMessage({ ok: false, why: "出力が違う" });
          return;
        }
      }
      self.postMessage({ ok: true, why: "ok" });
      return;
    }
    pyodide.globals.set("USER_CODE", code);
    pyodide.globals.set("HELPER", run.helper ? HELPER : "");
    pyodide.globals.set("EXPR", run.expr || "");
    pyodide.globals.set("SCRIPT", run.script || "");
    pyodide.globals.set("MODE", mode);
    pyodide.runPython(`
import sys, io
def _fmt(v):
    if isinstance(v, float):
        if abs(v - round(v)) < 1e-9:
            return str(int(round(v)))
        return f"{v:.5g}"
    if isinstance(v, list):
        return "[" + ",".join(_fmt(x) for x in v) + "]"
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)
ns = {}
ERR = ""
OUT = ""
try:
    if HELPER:
        exec(HELPER, ns, ns)
    exec(USER_CODE, ns, ns)
    if MODE == "expr":
        OUT = _fmt(eval(EXPR, ns, ns))
    else:
        buf = io.StringIO()
        old = sys.stdout
        sys.stdout = buf
        try:
            exec(SCRIPT, ns, ns)
        finally:
            sys.stdout = old
        OUT = buf.getvalue()
except Exception as e:
    ERR = type(e).__name__ + ": " + str(e)
`);
    const err = pyodide.globals.get("ERR");
    if (err) {
      self.postMessage({ ok: false, why: String(err).slice(0, 200) });
      return;
    }
    const got = String(pyodide.globals.get("OUT") || "");
    if (norm(got) !== norm(run.out || (msg.io && msg.io[0] && msg.io[0].out) || "")) {
      self.postMessage({ ok: false, why: "出力が違う" });
      return;
    }
    self.postMessage({ ok: true, why: "ok" });
  } catch (err) {
    self.postMessage({ ok: false, why: String(err).slice(0, 200) });
  }
};
