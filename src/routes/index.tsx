import { createFileRoute } from "@tanstack/react-router";
import { AsternalEditor } from "@/components/engine/AsternalEditor";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Editor Asternal" },
      {
        name: "description",
        content: "Editor nativo de escenas y juegos de Asternal.",
      },
    ],
  }),
  component: () => <AsternalEditor />,
});
