"use client"

/**
 * HoverCard — a small panel that opens on hover on a pointer device and on TAP
 * on a touch device.
 *
 * Built on Base UI's Popover rather than its Tooltip on purpose: Tooltip opens
 * on hover/focus only, so on a phone (where most people read results) it would
 * never open at all. Popover's `openOnHover` gives the desktop hover behavior
 * while keeping the press-to-open a popover already has, which is the one
 * interaction that works on both.
 */

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

function HoverCard({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({
  delay = 120,
  closeDelay = 80,
  ...props
}: PopoverPrimitive.Trigger.Props) {
  return (
    <PopoverPrimitive.Trigger
      data-slot="hover-card-trigger"
      openOnHover
      delay={delay}
      closeDelay={closeDelay}
      {...props}
    />
  )
}

function HoverCardContent({
  className,
  children,
  side = "top",
  sideOffset = 6,
  align = "start",
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "side" | "sideOffset" | "align">) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="z-50">
        <PopoverPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            "max-w-[min(22rem,calc(100vw-2rem))] rounded-xl bg-popover p-3 text-sm text-popover-foreground ring-1 ring-foreground/10 shadow-md duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { HoverCard, HoverCardContent, HoverCardTrigger }
