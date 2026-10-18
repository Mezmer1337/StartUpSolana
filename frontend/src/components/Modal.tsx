import type { FC, ReactNode } from "react";

export const Modal: FC<{ open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }> = ({
  open,
  onClose,
  title,
  children,
  wide,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative glass rounded-2xl w-full ${wide ? "max-w-2xl" : "max-w-md"} p-4 sm:p-6 shadow-2xl max-h-[92vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
