// Demo-only seed data for the Rider front-end prototype.
// Update these records as campus locations and verified drivers change.
export const locations = [
  ...Array.from({ length: 16 }, (_, index) => {
    const letter = String.fromCharCode(65 + index);
    return {
      id: `hostel-${letter.toLowerCase()}`,
      name: `Hostel ${letter}`,
      zone: "standard",
      type: "hostel",
    };
  }),
  { id: "cicl", name: "CICL", zone: "standard", type: "hostel" },
  { id: "paetos", name: "PAETOS", zone: "standard", type: "hostel" },
  { id: "old-kelson", name: "Old Kelson", zone: "standard", type: "hostel" },
  { id: "new-kelson", name: "New Kelson", zone: "standard", type: "hostel" },
  { id: "stanzel-hostel", name: "Stanzel Hostel", zone: "standard", type: "hostel" },
  { id: "hostel-r", name: "Hostel R", zone: "premium-hostel", type: "hostel" },
  { id: "hostel-s", name: "Hostel S", zone: "premium-hostel", type: "hostel" },
  { id: "hostel-t", name: "Hostel T", zone: "premium-hostel", type: "hostel" },
  { id: "law-faculty", name: "Law Faculty", zone: "campus", type: "faculty" },
  { id: "auditorium", name: "Auditorium", zone: "campus", type: "building" },
  { id: "clinic", name: "Clinic", zone: "campus", type: "medical" },
  { id: "pharmacy-building", name: "Pharmacy Building", zone: "campus", type: "building" },
  { id: "medicine-building", name: "Medicine Building", zone: "campus", type: "building" },
  { id: "multipurpose-hall", name: "Multipurpose Hall", zone: "campus", type: "building" },
  { id: "new-lecture-theatre", name: "New Lecture Theatre", zone: "campus", type: "building" },
  { id: "senate-building", name: "Senate Building", zone: "campus", type: "building" },
  { id: "chapel", name: "Chapel", zone: "campus", type: "chapel" },
  { id: "boys-hostel-gate", name: "Boys Hostel Gate", zone: "campus", type: "gate" },
  { id: "school-gate", name: "School Gate", zone: "campus", type: "gate" },
  { id: "block-a", name: "Block A", zone: "campus", type: "building" },
  { id: "block-b", name: "Block B", zone: "campus", type: "building" },
  { id: "block-c", name: "Block C", zone: "campus", type: "building" },
  { id: "block-d", name: "Block D", zone: "campus", type: "building" },
  { id: "veritas-cafe", name: "Veritas Cafe", zone: "campus", type: "cafeteria" },
];

export const mockDrivers = [
  {
    id: "driver-001",
    name: "Abdullahi Musa",
    plateNumber: "ABC 123 XY",
    phone: "+234 803 000 1001",
    rating: 4.8,
    verified: true,
  },
  {
    id: "driver-002",
    name: "Chinedu Okafor",
    plateNumber: "ABC 456 XY",
    phone: "+234 803 000 1002",
    rating: 4.6,
    verified: true,
  },
  {
    id: "driver-003",
    name: "Ibrahim Bello",
    plateNumber: "ABC 789 XY",
    phone: "+234 803 000 1003",
    rating: 4.9,
    verified: true,
  },
];

// These accounts and passwords are only for local prototype demos.
// Never store real user passwords in client-side code or localStorage.
export const starterUsers = [
  {
    id: "user-student-demo",
    name: "Demo Student",
    email: "student@rider.demo",
    password: "RiderDemo123!",
    phone: "+234 803 000 2001",
    role: "student",
  },
  {
    id: "user-driver-demo",
    name: "Abdullahi Musa",
    email: "driver@rider.demo",
    password: "RiderDemo123!",
    phone: "+234 803 000 1001",
    role: "driver",
    driverId: "driver-001",
  },
];
