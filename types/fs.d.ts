type Enumerate<N extends number, Acc extends number[] = []> = Acc['length'] extends N
    ? Acc[number]
    : Enumerate<N, [...Acc, Acc['length']]>

type IntRangeE<F extends number, T extends number> = Exclude<Enumerate<T>, Enumerate<F>>

type IntRangeI<F extends number, T extends number> = IntRangeE<F, T> | T

type INode = {
    type: "dir" | "file"
    created: number,
    modified: number,
    perms: IntRange<0, 0o777>,
    owner: string,
    group: string,
} | {
    type: "dir",
    children: Record<string, number>
} | {
    type: "file",
    contents: number[],
}

type JSONNode = {
    mode: number;
    owner: string;
    group: string;
} & (
        {
            type: "dir";
            children: Record<string, JSONNode>;
        }
        |
        {
            type: "file";
            content: string;
            include?: never;
        }
        |
        {
            type: "file";
            include: string;
            content?: never;
        }
    );
