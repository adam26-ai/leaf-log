import { notFound } from "next/navigation";
import { RowDesigner } from "@/components/dev/row-designer";

export default function RowDesignerPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <RowDesigner />;
}
