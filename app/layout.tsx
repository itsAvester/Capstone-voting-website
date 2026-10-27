import './globals.css';
import type { Metadata } from 'next';
export const metadata:Metadata={
  title:'Search Arena | Human Review',
  description:'Blind human preference annotations for Search Arena capstone',
  robots:{index:false,follow:false}
};
export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body>{children}</body></html>;
}
