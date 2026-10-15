export type EditionFormat = "all" | "ebook" | "audio" | "print" | "unknown";

export default function EditionFormatSelect({
  value,
  onChange,
}: {
  value: EditionFormat;
  onChange: (value: EditionFormat) => void;
}) {
  return (
    <label>
      Edition format
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as EditionFormat)}
      >
        <option value="all">All formats</option>
        <option value="ebook">Ebook</option>
        <option value="audio">Audiobook</option>
        <option value="print">Print</option>
        <option value="unknown">Other / unspecified</option>
      </select>
    </label>
  );
}
