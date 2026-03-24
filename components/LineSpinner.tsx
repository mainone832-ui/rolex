export default function LineSpinner() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
      <div className="relative h-20 w-20">
        {/* Outer blue arc */}
        <svg
          className="absolute inset-0 h-full w-full animate-[spinCW_1.4s_linear_infinite]"
          viewBox="0 0 80 80"
        >
          <circle
            cx="40"
            cy="40"
            r="34"
            fill="none"
            stroke="#2563eb"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray="140 214"
          />
        </svg>
        {/* Inner red arc */}
        <svg
          className="absolute inset-0 h-full w-full animate-[spinCCW_1.4s_linear_infinite]"
          viewBox="0 0 80 80"
        >
          <circle
            cx="40"
            cy="40"
            r="22"
            fill="none"
            stroke="#dc2626"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray="70 138"
          />
        </svg>
      </div>
      <span className="text-lg font-semibold text-[#222]">Loading Data...</span>
      <style>{`
        @keyframes spinCW {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes spinCCW {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(-360deg); }
        }
      `}</style>
    </div>
  );
}
