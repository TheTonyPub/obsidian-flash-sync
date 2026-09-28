"""Disposable PTY checks; sends synthetic values and never applies host changes."""
import errno
import fcntl
import os
import pty
import re
import select
import struct
import subprocess
import sys
import termios
import time


class Terminal:
    def __init__(self, command, env=None, rows=10, columns=35):
        self.master, self.slave = pty.openpty()
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
        self.original = termios.tcgetattr(self.slave)
        self.process = subprocess.Popen(command, stdin=self.slave, stdout=self.slave,
                                        stderr=self.slave, start_new_session=True,
                                        preexec_fn=lambda: fcntl.ioctl(self.slave, termios.TIOCSCTTY, 0),
                                        env={**os.environ, "TERM": "xterm-256color", **(env or {})})
        self.text = b""

    def read(self):
        if select.select([self.master], [], [], 0.05)[0]:
            try:
                self.text += os.read(self.master, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise

    def wait_for(self, fragment):
        deadline = time.monotonic() + 5
        while fragment.encode() not in self.text:
            self.read()
            if self.process.poll() is not None:
                raise AssertionError("PTY exited before expected prompt: " + self.text.decode(errors="replace")[-1000:].replace("fixture-only", "[synthetic secret]"))
            if time.monotonic() > deadline:
                raise AssertionError("PTY did not reach expected fixture prompt: " + fragment)

    def send(self, text):
        os.write(self.master, text.encode())

    def finish(self, status, check_modes=True):
        if check_modes:
            current = termios.tcgetattr(self.slave)
            assert (current[3] & (termios.ECHO | termios.ICANON)) == (self.original[3] & (termios.ECHO | termios.ICANON)), "Terminal mode not restored"
        deadline = time.monotonic() + 5
        while self.process.poll() is None:
            self.read()
            assert time.monotonic() < deadline, "PTY process failed to exit"
        for _ in range(4):
            self.read()
        assert self.process.returncode == status, "Unexpected PTY exit status"

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait()
        os.close(self.master)
        os.close(self.slave)


node, fixture, main = sys.argv[1:]
for env in ({}, {"NO_COLOR": "1"}, {"TERM": "dumb"}):
    terminal = Terminal([node, fixture], env)
    try:
        terminal.wait_for("Choose fixture")
        if env.get("TERM") == "dumb":
            terminal.wait_for("Choose number")
            terminal.send("12\n")
        else:
            for _ in range(11):
                terminal.send("\x1b[B")
                time.sleep(0.015)
            terminal.wait_for("日本語")
            terminal.send("\r")
        terminal.wait_for("Fixture secret")
        terminal.send("fixture-only\r")
        terminal.wait_for("Apply fixture?")
        terminal.send("\r")
        terminal.wait_for("RESULT:11:true:false")
        terminal.finish(0)
        assert b"fixture-only" not in terminal.text, "Secret echoed"
        if env.get("TERM") == "dumb":
            assert b"\x1b" not in terminal.text, "Plain terminal contains controls"
        else:
            assert b"\x1b[?25h" in terminal.text, "Cursor not restored"
        if env.get("NO_COLOR"):
            assert re.search(rb"\x1b\[[0-9;]*m", terminal.text) is None, "NO_COLOR contains color"
    finally:
        terminal.close()

for env in ({}, {"TERM": "dumb"}):
    terminal = Terminal([node, fixture], env)
    try:
        terminal.wait_for("Choose fixture")
        # Pause until listeners are installed, then cancel without any mutation.
        time.sleep(0.05)
        terminal.send("\x03")
        terminal.wait_for("ERROR:INPUT_CANCELLED")
        terminal.finish(130)
    finally:
        terminal.close()

# Actual distributed entry point: decline/cancel before platform preflight/apply.
terminal = Terminal([node, main, "bootstrap"])
try:
    terminal.wait_for("Installation mode")
    terminal.send("\x1b[B\r")
    terminal.wait_for("Endpoint domain")
    terminal.send("invalid domain\r")
    terminal.wait_for("Enter a valid endpoint domain")
    terminal.send("\x03")
    terminal.wait_for("INPUT_CANCELLED")
    terminal.finish(130, check_modes=False)
finally:
    terminal.close()

print("PTY checks passed: arrows, pagination, Unicode, narrow dimensions, secret non-echo, default cancellation, NO_COLOR, dumb terminal, exit 130, restored input/cursor, packaged bootstrap validation")
