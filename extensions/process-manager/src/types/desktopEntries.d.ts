declare module 'xdg-basedir' {
  export const dataDirs: string[];
}

declare module 'xdg-parse' {
  function parse(content: string): Record<string, Record<string, string>>;
  export = parse;
}
