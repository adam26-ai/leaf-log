import Image from "next/image";

/** The Leaf symbol and Log wordmark in the shared capsule lockup. */
export function LeafLogLogo() {
  return (
    <Image
      src="/leaf-log-capsule.png"
      alt="Leaf Log"
      width={112}
      height={42}
      className="block h-auto w-[84px] shrink-0 sm:h-[42px] sm:w-[112px]"
      unoptimized
      loading="eager"
    />
  );
}
