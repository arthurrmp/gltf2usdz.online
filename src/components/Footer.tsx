import CibKoFi from "@/icons/CibKoFi";
import MdiGithub from "@/icons/MdiGithub";

export const Footer = () => {
  return (
    <div className="absolute z-10 w-screen text-center text-white bottom-3">
      <p>
        {"Open source tool created by "}
        <a
          className="font-bold hover:underline"
          href="https://github.com/arthurrmp/gltf2usdz.online"
          target="_blank"
        >
          <span>
            arthurrmp
            <MdiGithub className="inline ml-1" />
          </span>
        </a>
      </p>
      <p>
        {"If you've found this helpful, consider "}
        <a
          className="font-bold hover:underline"
          href="https://ko-fi.com/arthurrmp"
          target="_blank"
        >
          buying me a coffee
          <CibKoFi className="inline ml-1" />
        </a>
      </p>
    </div>
  );
}
