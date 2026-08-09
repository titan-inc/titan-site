import { Apply } from './_components/apply/apply';
import { Hero } from './_components/hero';
import { Roster } from './_components/roster/roster';
import { Sobre } from './_components/sobre';
export default function Home() {
  return (
    <>
      <Hero />
      <Sobre />
      <Roster />
      <Apply />
    </>
  );
}
