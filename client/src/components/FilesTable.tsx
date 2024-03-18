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

export const FilesTable = ({ convertedFiles }: { convertedFiles: ConvertedFile[] }) => {
  return (
    <Table className="mt-10">
      <TableCaption>
        {convertedFiles.length
          ? "The links will be available for 30 minutes."
          : "Select your first file."}
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[300px]">Valid until</TableHead>
          <TableHead>File</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {convertedFiles.map(({ expires, id, name }) => (
          <TableRow key={id}>
            <TableCell className="font-medium">
              {" "}
              {new Date(expires).toString()}{" "}
            </TableCell>
            <TableCell className="text-left">
              <a
                href={`/api/download?id=${id}&name=${name}`}
                className="hover:underline"
              >
                {name}
                <MaterialSymbolsCloudDownload className="inline ml-1" />
              </a>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}