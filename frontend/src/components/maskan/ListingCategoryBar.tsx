import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import {
  Building2, Home, Warehouse, LandPlot, Store, Briefcase, Layers, Sofa,
  Tent, Factory, Wheat, Hotel, Fuel, DoorOpen, School, ParkingCircle,
  Wrench, ChevronDown, DoorOpen as RentIcon, Key,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/context";
import {
  mainCategories, moreCategories, type ListingType,
} from "@/lib/listingCategories";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Apartment: Building2,
  Villa: Home,
  "Big Flat": Building2,
  Building: Building2,
  Land: LandPlot,
  Store: Store,
  Office: Briefcase,
  Floor: Layers,
  Lounge: Sofa,
  Chalet: Tent,
  Complex: Building2,
  Factory: Factory,
  Farm: Wheat,
  Hotel: Hotel,
  Kiosk: Store,
  Parking: ParkingCircle,
  Room: DoorOpen,
  School: School,
  Station: Fuel,
  Tower: Building2,
  Warehouse: Warehouse,
  Workshop: Wrench,
};

export function ListingCategoryBar({
  listingType,
  onListingTypeChange,
  propertyType,
  onPropertyTypeChange,
  className,
}: {
  listingType: ListingType;
  onListingTypeChange: (v: ListingType) => void;
  propertyType: string;
  onPropertyTypeChange: (v: string) => void;
  className?: string;
}) {
  const { t, dir } = useLanguage();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  // The chip row scrolls horizontally (overflow-x-auto), which clips any
  // absolutely-positioned child vertically too — so the dropdown is portaled
  // to <body> and positioned from the trigger button's real screen coords.
  useEffect(() => {
    if (!moreOpen) return;
    function updatePos() {
      const rect = moreBtnRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos(
        dir === "rtl"
          ? { top: rect.bottom + 8, left: rect.right - 256 }
          : { top: rect.bottom + 8, left: rect.left },
      );
    }
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [moreOpen, dir]);

  const main = mainCategories(listingType);
  const more = moreCategories(listingType);
  const moreActive = more.includes(propertyType as (typeof more)[number]);

  function selectType(v: string) {
    onPropertyTypeChange(v);
    setMoreOpen(false);
  }

  function switchListingType(v: ListingType) {
    // Categories differ per tab — the caller's onListingTypeChange is expected
    // to reset propertyType to "Any" itself (as a single state update; calling
    // onPropertyTypeChange separately here would race against it and clobber
    // whichever update lands second, since both read from the same stale state).
    onListingTypeChange(v);
    setMoreOpen(false);
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Rent / Sale toggle */}
      <div className="inline-flex rounded-xl border border-border bg-surface p-1">
        <button
          type="button"
          onClick={() => switchListingType("rent")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
            listingType === "rent" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <RentIcon className="size-4" /> {t("listingCategories.rent")}
        </button>
        <button
          type="button"
          onClick={() => switchListingType("sale")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
            listingType === "sale" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Key className="size-4" /> {t("listingCategories.sale")}
        </button>
      </div>

      {/* Category chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <CategoryChip
          label={t("listingCategories.all")}
          active={propertyType === "Any"}
          onClick={() => selectType("Any")}
        />
        {main.map((type) => {
          const Icon = CATEGORY_ICONS[type];
          return (
            <CategoryChip
              key={type}
              label={t(`propertyTypes.${type}`)}
              icon={Icon}
              active={propertyType === type}
              onClick={() => selectType(type)}
            />
          );
        })}

        <div className="relative shrink-0">
          <button
            ref={moreBtnRef}
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors",
              moreActive ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-surface",
            )}
          >
            {moreActive ? t(`propertyTypes.${propertyType}`) : t("listingCategories.more")}
            <ChevronDown className={cn("size-3.5 transition-transform", moreOpen && "rotate-180")} />
          </button>
          {moreOpen && menuPos && typeof document !== "undefined" && createPortal(
            <>
              <button
                type="button"
                className="fixed inset-0 z-[1400] cursor-default"
                onClick={() => setMoreOpen(false)}
                aria-label={t("common.close")}
              />
              <div
                className="fixed z-[1401] grid w-64 grid-cols-2 gap-1 rounded-xl border border-border bg-popover p-2 shadow-elevated"
                style={{ top: menuPos.top, left: menuPos.left }}
              >
                {more.map((type) => {
                  const Icon = CATEGORY_ICONS[type];
                  const active = propertyType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => selectType(type)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-start text-xs font-medium transition-colors",
                        active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-surface-2",
                      )}
                    >
                      {Icon && <Icon className="size-3.5 shrink-0" />}
                      <span className="truncate">{t(`propertyTypes.${type}`)}</span>
                    </button>
                  );
                })}
              </div>
            </>,
            document.body,
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryChip({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon?: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-surface",
      )}
    >
      {Icon && <Icon className="size-3.5" />}
      {label}
    </button>
  );
}
