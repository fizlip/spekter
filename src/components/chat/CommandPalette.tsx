export type CommandItem = {
  name: string;
  text: string;
};

export function CommandPalette({
  items,
  activeIndex,
  onSelect,
  onHover,
}: {
  items: CommandItem[];
  activeIndex: number;
  onSelect: (item: CommandItem) => void;
  onHover: (index: number) => void;
}) {
  return (
    <div className="absolute inset-x-0 bottom-full z-10 mb-1 rounded-md bg-white p-1 shadow-md ring-1 ring-foreground/10">
      {items.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-slate-400">No matching commands</p>
      ) : (
        <ul role="listbox">
          {items.map((item, index) => (
            <li key={item.name} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                // Prevent stealing focus from the textarea while clicking an item.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHover(index)}
                onClick={() => onSelect(item)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                  index === activeIndex ? "bg-gray-100 text-black" : "text-gray-800"
                }`}
              >
                <span className="font-medium">{item.name}</span>
                <span className="truncate text-slate-400">{item.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
