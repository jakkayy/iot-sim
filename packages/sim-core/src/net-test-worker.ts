import { WorkerNet, type NetShared, type NetRequest } from "./net";

declare const self: Worker;

// Runs one scenario inside a real Worker so Atomics.wait blocks a real thread.
self.onmessage = (e: MessageEvent<{ shared: NetShared; scenario: string }>) => {
  const net = new WorkerNet(e.data.shared, (m: NetRequest) => self.postMessage(m));
  const out: Record<string, unknown> = {};
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  switch (e.data.scenario) {
    case "basic": {
      out.connect = net.mqttConnect({ host: "h", port: 1883, clientId: "c1" });
      out.up = net.mqttConnected();
      out.sub = net.mqttSubscribe("sim/x/cmd");
      out.pub = net.mqttPublish("sim/x/temp", enc.encode("25.5"), true);
      // wait (blocking) until the UI has delivered the echo into the inbox
      const t0 = performance.now();
      let msg = net.mqttPoll();
      while (!msg && performance.now() - t0 < 3000) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        msg = net.mqttPoll();
      }
      out.msg = msg && { topic: msg.topic, payload: dec.decode(msg.payload) };
      out.empty = net.mqttPoll();
      break;
    }
    case "timeout": {
      const t0 = performance.now();
      out.res = net.mqttConnect({ host: "h", port: 1, clientId: "c" }, 150);
      out.ms = performance.now() - t0;
      break;
    }
    case "notConnected": {
      out.pub = net.mqttPublish("t", enc.encode("x"));
      out.up = net.mqttConnected();
      break;
    }
    case "wifi": {
      out.fail = net.wifiShouldFail();
      break;
    }
    case "http": {
      out.res = net.httpRequest({ method: "GET", url: "https://api.test/x" });
      out.bad = net.httpRequest({ method: "GET", url: "https://blocked.test/x" });
      break;
    }
    case "flood": {
      net.mqttConnect({ host: "h", port: 1883, clientId: "c" });
      net.mqttSubscribe("flood");
      net.mqttPublish("flood", enc.encode("go"));
      const got: string[] = [];
      const t0 = performance.now();
      while (got.length < 400 && performance.now() - t0 < 5000) {
        const m = net.mqttPoll();
        if (m) got.push(dec.decode(m.payload));
        else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
      }
      out.count = got.length;
      out.inOrder = got.every((p, i) => p === `m${i}-${"x".repeat(200)}`);
      break;
    }
    case "reconnect": {
      out.first = net.mqttConnect({ host: "h", port: 1883, clientId: "a" });
      out.second = net.mqttConnect({ host: "h", port: 1883, clientId: "b" });
      out.up = net.mqttConnected();
      net.mqttDisconnect();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      out.upAfter = net.mqttConnected();
      break;
    }
  }
  self.postMessage({ done: true, out });
};
