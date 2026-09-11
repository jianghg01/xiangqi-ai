"""真实引擎行为测试：保持 stdin 打开，验证 FEN 合规性与 depth 24 耗时"""
import subprocess, time, sys

ENGINE = r"D:\1.DouBaoDownload\3.WB\xiangqi-ai\engine\Pikafish-Windows-x86-64-universal.exe"

def run(commands, wait_s, timeout=240):
    p = subprocess.Popen(
        [ENGINE], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, text=True, bufsize=1,
    )
    out = []
    t0 = time.time()
    for c in commands:
        p.stdin.write(c + "\n")
        p.stdin.flush()
    # 等待并读取输出
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = p.stdout.readline()
        if not line:
            break
        line = line.strip()
        if line.startswith("bestmove"):
            out.append(line)
            break
        if line.startswith("info depth") or line.startswith("id name") or line.startswith("readyok"):
            out.append(line)
    elapsed = time.time() - t0
    try:
        p.stdin.write("quit\n"); p.stdin.flush()
    except Exception:
        pass
    p.kill()
    return elapsed, out

print("=== 1. startpos 引擎坐标走4步（模拟开局库走完，引擎坐标，应正常）===")
e, o = run(["uci", "setoption name Threads value 4", "isready",
            "position startpos moves h7e7 h0g2 h9g7 i0h0", "go movetime 3000"], 30)
print(f"耗时 {e:.1f}s | bestmove={[x for x in o if x.startswith('bestmove')]}")

print("\n=== 2. 内部坐标 FEN（view.getFen 输出，rank0=黑底线在上）===")
# 开局 h7e7 h0g2 后的局面：内部坐标 FEN
fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
# 先做一步 h7e7（红中炮）
fen2 = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
e, o = run(["uci", "setoption name Threads value 4", "isready",
            f"position fen {fen2}", "go movetime 3000"], 30)
print(f"初始FEN 耗时 {e:.1f}s | bestmove={[x for x in o if x.startswith('bestmove')]}")

print("\n=== 3. 开局库走 4 步后（内部FEN）===")
# 手动重放 h7e7 h0g2 h9g7 i0h0：红炮二平五 黑马8进7 红马二进三 黑车9平8
# 直接用 moves 让引擎自己摆（引擎坐标走法，rank0=红底线）
e, o = run(["uci", "setoption name Threads value 4", "isready",
            "position fen " + fen2 + " moves h7e7 h0g2 h9g7 i0h0", "go movetime 3000"], 30)
print(f"4步后 耗时 {e:.1f}s | bestmove={[x for x in o if x.startswith('bestmove')]}")

print("\n=== 4. depth 24 真实耗时（startpos，等自然完成）===")
e, o = run(["uci", "setoption name Threads value 4", "isready",
            "position startpos", "go depth 24"], 240)
print(f"耗时 {e:.1f}s | bestmove={[x for x in o if x.startswith('bestmove')]}")

print("\n=== 5. 疑点验证：go depth 24 中途发 stop，能否立刻 bestmove ===")
p = subprocess.Popen([ENGINE], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=subprocess.DEVNULL, text=True, bufsize=1)
for c in ["uci", "setoption name Threads value 4", "isready", "position startpos", "go depth 24"]:
    p.stdin.write(c + "\n"); p.stdin.flush()
time.sleep(3)
p.stdin.write("stop\n"); p.stdin.flush()
t0 = time.time()
bm = None
while time.time() - t0 < 10:
    line = p.stdout.readline()
    if not line: break
    if line.strip().startswith("bestmove"):
        bm = line.strip(); break
print(f"stop后 {time.time()-t0:.2f}s 收到: {bm}")
p.kill()
