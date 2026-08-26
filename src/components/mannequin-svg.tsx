export type MannequinView = "front" | "back";

export function MannequinSVG({
  view = "front",
  className = "",
}: {
  view?: MannequinView;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 200 400"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {view === "front" ? <FrontSilhouette /> : <BackSilhouette />}
    </svg>
  );
}

function FrontSilhouette() {
  return (
    <>
      {/* Head */}
      <ellipse cx="100" cy="45" rx="22" ry="28" opacity="0.4" />
      
      {/* Neck */}
      <path d="M 88 73 L 88 85 M 112 73 L 112 85" opacity="0.4" />
      
      {/* Shoulders */}
      <path d="M 55 95 Q 70 85 88 88 M 145 95 Q 130 85 112 88" opacity="0.4" />
      
      {/* Torso */}
      <path d="M 55 95 L 52 180 Q 52 190 60 195 L 80 200 M 145 95 L 148 180 Q 148 190 140 195 L 120 200" opacity="0.4" />
      
      {/* Waist */}
      <path d="M 60 195 Q 100 205 140 195" opacity="0.4" />
      
      {/* Hips */}
      <path d="M 60 195 L 58 240 Q 58 250 65 255 L 85 260 M 140 195 L 142 240 Q 142 250 135 255 L 115 260" opacity="0.4" />
      
      {/* Upper arms (cut off like dress form) */}
      <path d="M 55 95 L 42 130 Q 38 140 42 145 M 145 95 L 158 130 Q 162 140 158 145" opacity="0.4" />
      
      {/* Legs */}
      <path d="M 85 260 L 82 360 Q 82 370 88 375 M 115 260 L 118 360 Q 118 370 112 375" opacity="0.4" />
      
      {/* Feet */}
      <path d="M 88 375 L 75 380 Q 72 382 75 385 L 90 385 M 112 375 L 125 380 Q 128 382 125 385 L 110 385" opacity="0.4" />
      
      {/* Center line (subtle) */}
      <path d="M 100 85 L 100 200" strokeDasharray="4 4" opacity="0.2" />
    </>
  );
}

function BackSilhouette() {
  return (
    <>
      {/* Head */}
      <ellipse cx="100" cy="45" rx="22" ry="28" opacity="0.4" />
      
      {/* Neck */}
      <path d="M 88 73 L 88 85 M 112 73 L 112 85" opacity="0.4" />
      
      {/* Shoulders (slightly different slope for back) */}
      <path d="M 52 98 Q 68 88 88 90 M 148 98 Q 132 88 112 90" opacity="0.4" />
      
      {/* Torso */}
      <path d="M 52 98 L 50 180 Q 50 190 58 195 L 80 200 M 148 98 L 150 180 Q 150 190 142 195 L 120 200" opacity="0.4" />
      
      {/* Waist */}
      <path d="M 58 195 Q 100 205 142 195" opacity="0.4" />
      
      {/* Hips */}
      <path d="M 58 195 L 56 240 Q 56 250 63 255 L 85 260 M 142 195 L 144 240 Q 144 250 137 255 L 115 260" opacity="0.4" />
      
      {/* Upper arms (cut off like dress form) */}
      <path d="M 52 98 L 38 132 Q 34 142 38 147 M 148 98 L 162 132 Q 166 142 162 147" opacity="0.4" />
      
      {/* Legs */}
      <path d="M 85 260 L 82 360 Q 82 370 88 375 M 115 260 L 118 360 Q 118 370 112 375" opacity="0.4" />
      
      {/* Feet */}
      <path d="M 88 375 L 75 380 Q 72 382 75 385 L 90 385 M 112 375 L 125 380 Q 128 382 125 385 L 110 385" opacity="0.4" />
      
      {/* Center back seam (subtle) */}
      <path d="M 100 90 L 100 200" strokeDasharray="4 4" opacity="0.2" />
      
      {/* Scapula hints */}
      <path d="M 70 110 L 85 130 M 130 110 L 115 130" opacity="0.2" />
    </>
  );
}