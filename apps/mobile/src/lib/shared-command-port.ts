// Glasses' command channel and the glove's command channel both hardcode
// the exact same TCP port -- 5010 -- per their own specs (PROTOCOL_GLASSES.md
// and PROTOCOL_GLOVE.md); neither is configurable from the app side. A
// second `listen()` call on a port already bound is the same silent
// double-bind failure mode already root-caused once this session (two
// GlassesSession instances both calling startTcp()), so this is the one
// listener for port 5010, shared by both devices. Each board dials out and
// sends `hello` as the very first line on a fresh connection; every hello
// carries a `device` field ("glasses" or "glove") per spec, which is enough
// to tell a brand new connection apart before handing it to the right link.
// Connect/data decoding is otherwise untouched -- the matched link gets the
// raw socket plus whatever bytes arrived before routing decided, and reads
// it exactly the way it always has.
import TcpSocket from "react-native-tcp-socket";

export const SHARED_COMMAND_PORT = 5010;

type TcpSocketInstance = InstanceType<typeof TcpSocket.Socket>;
export type CommandDeviceKind = "glasses" | "glove";
export type CommandConnectionHandler = (socket: TcpSocketInstance, initialData: string) => void;

class SharedCommandPort {
  private server: InstanceType<typeof TcpSocket.Server> | null = null;
  private handlers = new Map<CommandDeviceKind, CommandConnectionHandler>();
  private onLog: ((line: string) => void) | null = null;

  // Last registrant's logger wins -- fine, this is diagnostic-only and both
  // links log the same "shared port" events either way.
  register(kind: CommandDeviceKind, handler: CommandConnectionHandler, log?: (line: string) => void): () => void {
    this.handlers.set(kind, handler);
    if (log) this.onLog = log;
    this.ensureListening();
    return () => {
      if (this.handlers.get(kind) === handler) this.handlers.delete(kind);
      if (this.handlers.size === 0) this.stopListening();
    };
  }

  private log(line: string) {
    this.onLog?.(`shared command port: ${line}`);
  }

  private ensureListening() {
    if (this.server) return;
    this.server = TcpSocket.createServer((socket) => this.handleConnection(socket));
    this.server.listen({ port: SHARED_COMMAND_PORT, host: "0.0.0.0", reuseAddress: true });
    this.log(`listening on ${SHARED_COMMAND_PORT}`);
  }

  private stopListening() {
    this.server?.close();
    this.server = null;
    this.log("stopped listening (no registered devices left)");
  }

  private handleConnection(socket: TcpSocketInstance) {
    let buffer = "";
    let routed = false;

    const onData = (data: string | Buffer) => {
      if (routed) return; // shouldn't happen -- routing removes this listener, kept as a guard
      buffer += typeof data === "string" ? data : data.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return; // first line (the board's `hello`) hasn't fully arrived yet

      routed = true;
      socket.removeListener("data", onData);

      const firstLine = buffer.slice(0, newlineIndex);
      let kind: CommandDeviceKind | null = null;
      try {
        const parsed = JSON.parse(firstLine) as { device?: unknown };
        if (parsed.device === "glasses" || parsed.device === "glove") kind = parsed.device;
      } catch {
        // Unparseable first line -- fall through to "unknown device", dropped below.
      }

      const handler = kind ? this.handlers.get(kind) : null;
      if (!handler) {
        this.log(`connection's first line didn't identify a registered device (${JSON.stringify(firstLine).slice(0, 200)}) -- dropping`);
        socket.destroy();
        return;
      }
      handler(socket, buffer);
    };

    socket.setEncoding("utf8");
    socket.on("data", onData);
  }
}

export const sharedCommandPort = new SharedCommandPort();
