"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import type { EditorProps, OnMount } from "@monaco-editor/react";

export interface EditorMarker {
  line: number;
  message: string;
}

type MonacoApi = typeof import("monaco-editor");

/**
 * Monaco is loaded lazily and from our own bundle (never the CDN: COEP would
 * block it). Only the core editor plus the Python and C++ grammars are included.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  markers,
}: {
  value: string;
  onChange: (v: string) => void;
  language: "python" | "cpp";
  markers: EditorMarker[];
}) {
  const [Editor, setEditor] = useState<ComponentType<EditorProps> | null>(null);
  const monacoRef = useRef<MonacoApi | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const monaco = (await import("monaco-editor/esm/vs/editor/edcore.main")) as unknown as MonacoApi;
      await import("monaco-editor/esm/vs/basic-languages/python/python.contribution");
      await import("monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution");
      (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
        getWorker: () =>
          new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url)),
      };
      const react = await import("@monaco-editor/react");
      react.loader.config({ monaco });
      monacoRef.current = monaco;
      if (alive) setEditor(() => react.default);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (!monaco || !model) return;
    monaco.editor.setModelMarkers(
      model,
      "sim",
      markers.map((m) => {
        const line = Math.min(Math.max(1, m.line), model.getLineCount());
        return {
          severity: monaco.MarkerSeverity.Error,
          message: m.message,
          startLineNumber: line,
          endLineNumber: line,
          startColumn: 1,
          endColumn: model.getLineMaxColumn(line),
        };
      }),
    );
  }, [markers, ready, language]);

  if (!Editor) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading editor…</div>;
  }
  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      theme="vs-dark"
      onChange={(v) => onChange(v ?? "")}
      onMount={(editor) => {
        editorRef.current = editor;
        setReady(true);
      }}
      options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true }}
    />
  );
}
