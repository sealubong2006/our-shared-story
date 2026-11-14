import type { ReactNode } from "react";
import { motion } from "motion/react";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <h1 className="font-hand text-5xl font-bold leading-tight">{title}</h1>
      {subtitle && <div className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{subtitle}</div>}
      {children}
    </motion.header>
  );
}
