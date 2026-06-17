import { ConvertedFile } from "@/common";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import MaterialSymbolsCloudDownload from "@/icons/MaterialSymbolsCloudDownload";

const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const FilesTable = ({ convertedFiles }: { convertedFiles: ConvertedFile[] }) => {
  return (
    <Table className="mt-10">
      <TableCaption>
        {convertedFiles.length
          ? "Converted in your browser — nothing is uploaded."
          : "Select your first file."}
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[140px]">Size</TableHead>
          <TableHead>File</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {convertedFiles.map(({ name, url, size }) => (
          <TableRow key={url}>
            <TableCell className="font-medium">{formatSize(size)}</TableCell>
            <TableCell className="text-left">
              <a href={url} download={name} className="hover:underline">
                {name}
                <MaterialSymbolsCloudDownload className="inline ml-1" />
              </a>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
