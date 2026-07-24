"use client";

import { useRef, useState } from "react";
import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useTransform,
} from "motion/react";
import "./ShinyText.css";

type ShinyTextProps = {
  text: string;
  disabled?: boolean;
  speed?: number;
  className?: string;
  color?: string;
  shineColor?: string;
  spread?: number;
  yoyo?: boolean;
  pauseOnHover?: boolean;
  direction?: "left" | "right";
  delay?: number;
};

export default function ShinyText({
  text,
  disabled = false,
  speed = 2,
  className = "",
  color = "#b5b5b5",
  shineColor = "#ffffff",
  spread = 120,
  yoyo = false,
  pauseOnHover = false,
  direction = "left",
  delay = 0,
}: ShinyTextProps) {
  const motionProgress = useMotionValue(0);
  const [isPaused, setIsPaused] = useState(false);
  const lastTimeRef = useRef<number | null>(null);
  const directionRef = useRef(direction === "left" ? 1 : -1);
  const delayUntilRef = useRef<number | null>(null);

  useAnimationFrame((time) => {
    if (disabled || isPaused) {
      lastTimeRef.current = time;
      return;
    }

    if (delayUntilRef.current !== null) {
      if (time < delayUntilRef.current) {
        lastTimeRef.current = time;
        return;
      }
      delayUntilRef.current = null;
    }

    if (lastTimeRef.current === null) {
      lastTimeRef.current = time;
      return;
    }

    const delta = time - lastTimeRef.current;
    lastTimeRef.current = time;
    const duration = Math.max(speed, 0.05) * 1000;
    let next = motionProgress.get() + (delta / duration) * 100 * directionRef.current;

    if (yoyo) {
      if (next >= 100 || next <= 0) {
        next = Math.max(0, Math.min(100, next));
        directionRef.current *= -1;
        if (delay > 0) delayUntilRef.current = time + delay * 1000;
      }
    } else if (next >= 100 || next <= -100) {
      next = 0;
      if (delay > 0) delayUntilRef.current = time + delay * 1000;
    }

    motionProgress.set(next);
  });

  const backgroundPosition = useTransform(
    motionProgress,
    [0, 100],
    direction === "left" ? ["100% center", "-100% center"] : ["-100% center", "100% center"],
  );

  return (
    <motion.span
      className={`shiny-text ${className}`.trim()}
      onMouseEnter={() => pauseOnHover && setIsPaused(true)}
      onMouseLeave={() => pauseOnHover && setIsPaused(false)}
      style={{
        backgroundImage: `linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
        backgroundSize: "200% auto",
        backgroundPosition,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
      }}
    >
      {text}
    </motion.span>
  );
}
