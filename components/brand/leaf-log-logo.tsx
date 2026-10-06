import Image from "next/image";

/** The Leaf symbol and Log wordmark in the shared capsule lockup. */
export function LeafLogLogo({ compact = false, navigation = false }: { compact?: boolean; navigation?: boolean }) {
  const image = (
    <Image
      src="/leaf-log-capsule.png"
      alt="Leaf Log"
      width={112}
      height={42}
      className={compact
        ? `absolute left-1/2 block h-full w-auto max-w-none -translate-x-1/2${navigation ? " invisible group-aria-[current=page]:visible" : ""}`
        : "block h-auto w-[84px] shrink-0 sm:h-[42px] sm:w-[112px]"}
      unoptimized
      loading="eager"
    />
  );

  // Trim 15% of the pill's side padding without scaling or distorting the artwork.
  return compact ? (
    <span className={`relative block aspect-[306/135] h-8 shrink-0 overflow-hidden rounded-full min-[360px]:h-[34px] min-[400px]:h-[38px] min-[480px]:h-10 sm:h-[42px]${navigation ? " bg-slate-100 ring-1 ring-inset ring-slate-200 transition-colors group-hover:bg-sky-50 group-hover:ring-[#0099FF] group-aria-[current=page]:bg-transparent group-aria-[current=page]:ring-0" : ""}`}>
      {image}
      {navigation && <Image
        src="/leaf-log-outline.svg"
        alt=""
        aria-hidden="true"
        width={112}
        height={42}
        className="absolute left-1/2 block h-full w-auto max-w-none -translate-x-1/2 group-aria-[current=page]:invisible"
        unoptimized
        loading="eager"
      />}
    </span>
  ) : image;
}
