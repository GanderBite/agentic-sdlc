# Shadcn primitives and their Radix bases

Reference table of Shadcn UI primitives MedBridge is likely to scaffold, the Radix primitive each composes, and the canonical subcomponent tree. Use this when reviewing PRs that touch `apps/ui/src/components/ui/**` to verify the Radix subcomponent tree is intact (SKILL.md Rule 14).

## Layout & content

| Shadcn | Radix base | Required subtree |
|---|---|---|
| `accordion` | `@radix-ui/react-accordion` | `Accordion > AccordionItem > AccordionTrigger + AccordionContent` |
| `alert` | (none — pure styled `<div>`) | `Alert > AlertTitle? + AlertDescription?` |
| `alert-dialog` | `@radix-ui/react-alert-dialog` | `AlertDialog > AlertDialogTrigger + AlertDialogPortal > AlertDialogOverlay + AlertDialogContent > AlertDialogTitle + AlertDialogDescription + AlertDialogAction + AlertDialogCancel` |
| `aspect-ratio` | `@radix-ui/react-aspect-ratio` | `AspectRatio` |
| `avatar` | `@radix-ui/react-avatar` | `Avatar > AvatarImage + AvatarFallback` |
| `badge` | (none) | `Badge` |
| `card` | (none) | `Card > CardHeader > CardTitle + CardDescription + CardContent + CardFooter` |
| `collapsible` | `@radix-ui/react-collapsible` | `Collapsible > CollapsibleTrigger + CollapsibleContent` |
| `separator` | `@radix-ui/react-separator` | `Separator` |
| `skeleton` | (none) | `Skeleton` |

## Overlays

| Shadcn | Radix base | Required subtree |
|---|---|---|
| `dialog` | `@radix-ui/react-dialog` | `Dialog > DialogTrigger + DialogPortal > DialogOverlay + DialogContent > DialogTitle + DialogDescription + DialogClose` |
| `sheet` | `@radix-ui/react-dialog` (variant) | `Sheet > SheetTrigger + SheetContent > SheetHeader > SheetTitle + SheetDescription + SheetFooter + SheetClose` |
| `popover` | `@radix-ui/react-popover` | `Popover > PopoverTrigger + PopoverContent` |
| `hover-card` | `@radix-ui/react-hover-card` | `HoverCard > HoverCardTrigger + HoverCardContent` |
| `tooltip` | `@radix-ui/react-tooltip` | `TooltipProvider > Tooltip > TooltipTrigger + TooltipContent` (`TooltipProvider` once at app root) |
| `dropdown-menu` | `@radix-ui/react-dropdown-menu` | `DropdownMenu > DropdownMenuTrigger + DropdownMenuContent > DropdownMenuItem / DropdownMenuLabel / DropdownMenuSeparator / DropdownMenuSub*` |
| `context-menu` | `@radix-ui/react-context-menu` | analogous to dropdown-menu |
| `menubar` | `@radix-ui/react-menubar` | `Menubar > MenubarMenu > MenubarTrigger + MenubarContent > MenubarItem / MenubarSeparator / MenubarSub*` |
| `command` | `cmdk` (not Radix) | `Command > CommandInput + CommandList > CommandEmpty + CommandGroup > CommandItem` |

## Forms & inputs

| Shadcn | Radix base | Notes |
|---|---|---|
| `button` | (Slot) | Supports `asChild` via `@radix-ui/react-slot`. Variants via `cva`. |
| `checkbox` | `@radix-ui/react-checkbox` | `Checkbox > CheckboxIndicator` (indicator is wrapped by Shadcn). |
| `form` | (`react-hook-form` + `@radix-ui/react-label` + Slot) | See `references/forms.md`. |
| `input` | (none — plain `<input>`) | Pair with `<Label>`. |
| `input-otp` | `input-otp` package | `InputOTP > InputOTPGroup > InputOTPSlot` |
| `label` | `@radix-ui/react-label` | Pair every input with `<Label>`. |
| `radio-group` | `@radix-ui/react-radio-group` | `RadioGroup > RadioGroupItem` |
| `select` | `@radix-ui/react-select` | `Select > SelectTrigger > SelectValue + SelectContent > SelectGroup > SelectLabel + SelectItem + SelectSeparator` |
| `slider` | `@radix-ui/react-slider` | `Slider > SliderTrack > SliderRange + SliderThumb` |
| `switch` | `@radix-ui/react-switch` | `Switch > SwitchThumb` (thumb wrapped by Shadcn). |
| `textarea` | (none — plain `<textarea>`) | Pair with `<Label>` and `<FormMessage>`. |
| `toggle` | `@radix-ui/react-toggle` | `Toggle` |
| `toggle-group` | `@radix-ui/react-toggle-group` | `ToggleGroup > ToggleGroupItem` |

## Navigation

| Shadcn | Radix base | Required subtree |
|---|---|---|
| `breadcrumb` | (none) | `Breadcrumb > BreadcrumbList > BreadcrumbItem > BreadcrumbLink / BreadcrumbPage / BreadcrumbSeparator` |
| `navigation-menu` | `@radix-ui/react-navigation-menu` | `NavigationMenu > NavigationMenuList > NavigationMenuItem > NavigationMenuTrigger + NavigationMenuContent` |
| `pagination` | (none) | `Pagination > PaginationContent > PaginationItem > PaginationLink / PaginationPrevious / PaginationNext / PaginationEllipsis` |
| `tabs` | `@radix-ui/react-tabs` | `Tabs > TabsList > TabsTrigger + TabsContent` |

## Feedback

| Shadcn | Radix base | Required subtree |
|---|---|---|
| `progress` | `@radix-ui/react-progress` | `Progress > ProgressIndicator` (wrapped). |
| `sonner` | `sonner` package | `<Toaster />` at root; trigger with `toast(...)`. |

## Data

| Shadcn | Radix base | Required subtree |
|---|---|---|
| `table` | (none) | `Table > TableHeader > TableRow > TableHead + TableBody > TableRow > TableCell + TableFooter + TableCaption` |
| `scroll-area` | `@radix-ui/react-scroll-area` | `ScrollArea > ScrollAreaViewport + ScrollAreaScrollbar > ScrollAreaThumb + ScrollAreaCorner` |

## `asChild` quick reference

Most Radix triggers accept `asChild` to render a different element while keeping the Radix behavior. Common uses:

```tsx
<DialogTrigger asChild><Button>Open</Button></DialogTrigger>
<TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Settings">…</Button></TooltipTrigger>
<DropdownMenuItem asChild><Link to="/settings">Settings</Link></DropdownMenuItem>
<Button asChild><Link to="/patients">Patients</Link></Button>
```

Forbidden:

- `<Button onClick={() => navigate(…)}>` for navigation — use `asChild + Link`.
- `<a className="button-styles">` — use `<Button asChild><a>…</a></Button>` if `Link` is not appropriate.

## Required app-root primitives

These Shadcn components have a provider that MUST sit once at the app root (`apps/ui/src/main.tsx` or the root route):

- `TooltipProvider` (from `tooltip`)
- `Toaster` (from `sonner`)
- Theme provider (custom — see `references/theming.md`)

Never wrap them per-route. Multiple `TooltipProvider`s cause focus/timer races.
