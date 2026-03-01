declare module 'xirr' {
    function xirr(transactions: { amount: number; when: Date }[]): number;
    export = xirr;
}
