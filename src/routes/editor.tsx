import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AsternalEditor } from "@/components/engine/AsternalEditor";
import { writeLastEditorMode } from "@/lib/engine/last-editor-mode";

export const Route = createFileRoute("/editor")({
  validateSearch: (search: Record<string, unknown>) => ({
    p: typeof search.p === "string" && search.p ? search.p : undefined,
    beta: search.beta === true || search.beta === "1" ? true : undefined,
  }),
  head: () => ({ meta: [{ title: "Editor Asternal" }] }),
  component: EditorRoute,
});

function EditorRoute() {
  const { p, beta } = Route.useSearch();

  useEffect(() => {
    writeLastEditorMode("mini");
  }, []);

  return <AsternalEditor initialProjectId={p} beta={beta} />;
}
