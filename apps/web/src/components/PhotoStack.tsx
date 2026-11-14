import { motion } from "motion/react";

interface PhotoStackProps {
  /** Up to three image URLs, front photo first. Without images, soft paper placeholders are drawn. */
  images?: string[];
  className?: string;
  /** Spread the back photos further apart on hover (used on collection cards). */
  interactive?: boolean;
}

const PLACEHOLDER_TINTS = ["#d8cbbd", "#c9d3d6", "#e3d4c4"];

/**
 * The fanned three-photo stack from the "bookshelf" reference: one upright photo in front,
 * two tilted behind it.
 */
export function PhotoStack({ images = [], className = "", interactive = false }: PhotoStackProps) {
  const layers = [
    { rotate: -9, x: "-34%", y: "6%", z: 0 },
    { rotate: 8, x: "34%", y: "6%", z: 1 },
    { rotate: 0, x: "0%", y: "0%", z: 2 },
  ];
  const sources = [images[1], images[2], images[0]];

  return (
    <motion.div className={`relative aspect-[4/3] ${className}`} initial="rest" whileHover={interactive ? "hover" : undefined}>
      {layers.map((layer, i) => (
        <motion.div
          key={i}
          className="absolute inset-0 m-auto aspect-[4/5] h-[78%] overflow-hidden rounded-md border-[3px] border-page bg-page shadow-[var(--shadow-photo)]"
          style={{ zIndex: layer.z }}
          variants={{
            rest: { rotate: layer.rotate, x: layer.x, y: layer.y },
            hover: {
              rotate: layer.rotate * 1.4,
              x: layer.z === 2 ? "0%" : `calc(${layer.x} * 1.18)`,
              y: layer.z === 2 ? "-4%" : layer.y,
            },
          }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
        >
          {sources[i] ? (
            <img src={sources[i]} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} />
          ) : (
            <div
              className="h-full w-full"
              style={{ background: `linear-gradient(160deg, ${PLACEHOLDER_TINTS[i]}, #f1ebe3)` }}
            />
          )}
        </motion.div>
      ))}
    </motion.div>
  );
}
